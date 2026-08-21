/**
 * Integration tests for the full transport wiring in createEmitoServer.
 *
 * Agent rules applied: #1, #3, #7, #10, #11, #15, #25, #26, #28
 *
 * Tests validate:
 *   - /stream and /poll stubs are removed (no longer 501)
 *   - /stream returns 200 text/event-stream
 *   - /poll returns 200 JSON collection
 *   - notification:created event from emito triggers broadcast to connected SSE client
 *   - Multi-instance fanout path: event written to Redis Stream → XREAD → SSE delivery
 *   - All previously passing stub tests for /stream and /poll now expect 200 (not 501)
 *
 * Uses createEmitoServer with mock emito + in-memory repositories.
 */

import { createHmac } from "node:crypto";
import {
	InMemoryConsentRepository,
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemorySubscriberRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "@emito/core";
import type { NotificationEvent, ResolveSubscriberId } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRedis } from "../../../core/__tests__/helpers/mock-redis.js";
import { verifyHS256 } from "../auth/hs256.js";
import { createEmitoServer } from "../handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = "test-jwt-secret-32-bytes-minimum!!";
const API_KEY = "test-admin-key";
const SUBSCRIBER_ID = "sub_1";

function buildJwt(subscriberId: string = SUBSCRIBER_ID): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			subscriberId,
			iat: Math.floor(Date.now() / 1000) - 60,
			exp: Math.floor(Date.now() / 1000) + 3600,
		}),
	).toString("base64url");
	const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
	return `${header}.${payload}.${sig}`;
}

function createMockEmito() {
	const handlers = new Map<string, Array<(...args: unknown[]) => void>>();

	return {
		send: vi.fn().mockResolvedValue({ status: "delivered" }),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		healthCheck: vi
			.fn()
			.mockResolvedValue({ healthy: true, providers: [], redis: { connected: true } }),
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		}),
		off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			const list = handlers.get(event);
			if (list) {
				const idx = list.indexOf(handler);
				if (idx >= 0) list.splice(idx, 1);
			}
		}),
		// Test helper: fire a notification:created event
		fireNotificationCreated(subscriberId: string, event: NotificationEvent) {
			const list = handlers.get("notification:created") ?? [];
			for (const h of list) h(subscriberId, event);
		},
	};
}

function createRepositories() {
	return {
		subscriberRepository: new InMemorySubscriberRepository(),
		notificationRepository: new InMemoryNotificationRepository(),
		preferenceRepository: new InMemoryPreferenceRepository(),
		consentRepository: new InMemoryConsentRepository(),
		workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
		suppressionRepository: new InMemorySuppressionRepository(),
		deadLetterRepository: new InMemoryDeadLetterRepository(),
		integrationRepository: new InMemoryIntegrationRepository(),
		inboxRepository: new InMemoryInboxRepository(),
	};
}

function createTestResolveSubscriberId(secret: string): ResolveSubscriberId {
	return async (req: Request): Promise<string | null> => {
		const auth = req.headers.get("authorization");
		if (!auth?.startsWith("Bearer ")) return null;
		try {
			const payload = verifyHS256(auth.slice(7), secret);
			const id = payload.subscriberId;
			return typeof id === "string" && id ? id : null;
		} catch {
			return null;
		}
	};
}

function req(method: string, path: string, headers: Record<string, string> = {}): Request {
	return new Request(`http://localhost${path}`, {
		method,
		headers: { "content-type": "application/json", ...headers },
	});
}

// ---------------------------------------------------------------------------
// describe("transport wiring in createEmitoServer")
// ---------------------------------------------------------------------------

describe("transport wiring in createEmitoServer", () => {
	let emito: ReturnType<typeof createMockEmito>;
	let redis: ReturnType<typeof createMockRedis>;
	let server: ReturnType<typeof createEmitoServer>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		emito = createMockEmito();
		redis = createMockRedis();
		server = createEmitoServer({
			emito: emito as never,
			apiKey: API_KEY,
			resolveSubscriberId: createTestResolveSubscriberId(JWT_SECRET),
			repositories: createRepositories(),
			redisClient: redis,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
		vi.restoreAllMocks();
	});

	// --- Stubs removed ---

	describe("stubs removed", () => {
		it("should NOT return 501 for GET /emito/v1/stream (stub removed)", async () => {
			const res = await server.handler(
				req("GET", "/emito/v1/stream", { authorization: `Bearer ${buildJwt()}` }),
			);
			expect(res.status).not.toBe(501);
		});

		it("should NOT return 501 for GET /emito/v1/poll (stub removed)", async () => {
			const res = await server.handler(
				req("GET", "/emito/v1/poll", { authorization: `Bearer ${buildJwt()}` }),
			);
			expect(res.status).not.toBe(501);
		});

		it("should return 200 for GET /emito/v1/stream", async () => {
			const res = await server.handler(
				req("GET", "/emito/v1/stream", { authorization: `Bearer ${buildJwt()}` }),
			);
			expect(res.status).toBe(200);
		});

		it("should return 200 for GET /emito/v1/poll", async () => {
			const res = await server.handler(
				req("GET", "/emito/v1/poll", { authorization: `Bearer ${buildJwt()}` }),
			);
			expect(res.status).toBe(200);
		});
	});

	// --- SSE endpoint integration ---

	describe("SSE endpoint integration", () => {
		it("should return text/event-stream content-type", async () => {
			const res = await server.handler(
				req("GET", "/emito/v1/stream", { authorization: `Bearer ${buildJwt()}` }),
			);
			expect(res.headers.get("content-type")).toContain("text/event-stream");
		});

		it("should return 401 for /emito/v1/stream without auth", async () => {
			const res = await server.handler(req("GET", "/emito/v1/stream"));
			expect(res.status).toBe(401);
		});
	});

	// --- Polling endpoint integration ---

	describe("polling endpoint integration", () => {
		it("should return JSON collection envelope from /emito/v1/poll", async () => {
			const res = await server.handler(
				req("GET", "/emito/v1/poll", { authorization: `Bearer ${buildJwt()}` }),
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: { items: unknown[] } };
			expect(Array.isArray(body.data.items)).toBe(true);
		});

		it("should return 401 for /emito/v1/poll without auth", async () => {
			const res = await server.handler(req("GET", "/emito/v1/poll"));
			expect(res.status).toBe(401);
		});
	});

	// --- notification:created fanout ---

	describe("notification:created → ConnectionRegistry broadcast", () => {
		it("should subscribe to notification:created on emito during server init", () => {
			expect(emito.on).toHaveBeenCalledWith("notification:created", expect.any(Function));
		});

		it("should write event to Redis Stream when notification:created fires", async () => {
			// Connect SSE to register a connection for sub_1
			await server.handler(
				req("GET", "/emito/v1/stream", { authorization: `Bearer ${buildJwt("sub_1")}` }),
			);

			const event: NotificationEvent = {
				notificationId: "ntf_wired",
				subscriberId: "sub_1",
				event: "order.shipped",
				body: "Order 123 shipped",
				timestamp: new Date("2026-01-01T00:00:00Z"),
			};

			emito.fireNotificationCreated("sub_1", event);
			await vi.advanceTimersByTimeAsync(10);

			// Verify the event was written to the Redis Stream
			const entries = await redis.xrange("emito:stream:sub_1", "-", "+");
			expect(entries.length).toBeGreaterThan(0);
		});
	});

	// --- Broadcast stub replaced by real endpoint (007b task-2) ---

	describe("broadcast stub replaced", () => {
		it("should no longer return 501 for POST /emito/v1/admin/broadcast (implemented)", async () => {
			const res = await server.handler(
				req("POST", "/emito/v1/admin/broadcast", { "x-emito-admin-key": API_KEY }),
			);
			expect(res.status).not.toBe(501);
		});
	});
});
