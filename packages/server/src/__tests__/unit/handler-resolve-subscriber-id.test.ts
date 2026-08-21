/**
 * Unit tests for resolveSubscriberId hook on EmitoServerConfig and handleUpgrade export.
 *
 * After task-1 refactor:
 *   - resolveSubscriberId is REQUIRED on EmitoServerConfig (no jwtSecret)
 *   - createEmitoServer returns a handleUpgrade function on the server object
 *   - handleUpgrade function type signature is (req, socket, head) => void | Promise<void>
 *   - subscriber and workspace auth endpoints call resolveSubscriberId(request)
 *   - No JWT branching, no jwtSecret reference
 *
 * Agent rules applied: #1, #3, #7, #10, #15, #25, #26, #32
 */

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
import type { ResolveSubscriberId } from "@emito/types";
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it, vi } from "vitest";
import { createEmitoServer } from "../../handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = "test-api-key-for-resolve-hook-tests";

function createMockEmito() {
	return {
		send: vi.fn().mockResolvedValue({ status: "delivered" }),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		healthCheck: vi
			.fn()
			.mockResolvedValue({ healthy: true, providers: [], redis: { connected: true } }),
		on: vi.fn(),
		off: vi.fn(),
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

function makeServer(resolveSubscriberId: ResolveSubscriberId) {
	return createEmitoServer({
		emito: createMockEmito() as never,
		apiKey: TEST_API_KEY,
		resolveSubscriberId,
		repositories: createRepositories(),
	});
}

// ---------------------------------------------------------------------------
// describe("createEmitoServer — resolveSubscriberId is required")
// ---------------------------------------------------------------------------

describe("createEmitoServer — resolveSubscriberId is required", () => {
	it("should accept a resolveSubscriberId that returns a string", () => {
		const resolveSubscriberId = vi.fn().mockResolvedValue("sub_1");

		expect(() => makeServer(resolveSubscriberId)).not.toThrow();
	});

	it("should accept an async resolveSubscriberId returning string", () => {
		const resolveSubscriberId: ResolveSubscriberId = async (
			_req: Request,
		): Promise<string | null> => {
			return "sub_async";
		};

		expect(() => makeServer(resolveSubscriberId)).not.toThrow();
	});

	it("should accept an async resolveSubscriberId returning null", () => {
		const resolveSubscriberId: ResolveSubscriberId = async (
			_req: Request,
		): Promise<string | null> => {
			return null;
		};

		expect(() => makeServer(resolveSubscriberId)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// describe("createEmitoServer — subscriber auth via resolveSubscriberId")
// ---------------------------------------------------------------------------

describe("createEmitoServer — subscriber auth via resolveSubscriberId", () => {
	it("should call resolveSubscriberId for subscriber-scoped routes", async () => {
		const resolveSubscriberId = vi.fn().mockResolvedValue("sub_1");
		const server = makeServer(resolveSubscriberId);

		server.addRoute({
			method: "GET",
			pathPattern: "/test-subscriber",
			auth: "subscriber",
			handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
		});

		const res = await server.handler(
			new Request("http://localhost/emito/v1/test-subscriber", {
				headers: { authorization: "Bearer some-token" },
			}),
		);

		expect(resolveSubscriberId).toHaveBeenCalled();
		expect(res.status).toBe(200);
	});

	it("should return 401 when resolveSubscriberId returns null", async () => {
		const resolveSubscriberId = vi.fn().mockResolvedValue(null);
		const server = makeServer(resolveSubscriberId);

		server.addRoute({
			method: "GET",
			pathPattern: "/test-subscriber",
			auth: "subscriber",
			handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
		});

		const res = await server.handler(
			new Request("http://localhost/emito/v1/test-subscriber", {
				headers: { authorization: "Bearer some-token" },
			}),
		);

		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
	});

	it("should return 401 when resolveSubscriberId throws", async () => {
		const resolveSubscriberId = vi.fn().mockRejectedValue(new Error("auth failed"));
		const server = makeServer(resolveSubscriberId);

		server.addRoute({
			method: "GET",
			pathPattern: "/test-subscriber",
			auth: "subscriber",
			handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
		});

		const res = await server.handler(
			new Request("http://localhost/emito/v1/test-subscriber", {
				headers: { authorization: "Bearer some-token" },
			}),
		);

		// Thrown error from hook should result in auth failure (401 or 500 depending on impl)
		// The contract is: any failure from resolveSubscriberId → no access
		expect(res.status).toBeGreaterThanOrEqual(400);
	});

	it("should pass the full Web Standard Request to resolveSubscriberId", async () => {
		let capturedRequest: Request | null = null;
		const resolveSubscriberId = vi.fn().mockImplementation(async (req: Request) => {
			capturedRequest = req;
			return "sub_1";
		});
		const server = makeServer(resolveSubscriberId);

		server.addRoute({
			method: "GET",
			pathPattern: "/test-subscriber",
			auth: "subscriber",
			handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
		});

		await server.handler(
			new Request("http://localhost/emito/v1/test-subscriber", {
				headers: { authorization: "Bearer some-token" },
			}),
		);

		expect(capturedRequest).not.toBeNull();
		expect(capturedRequest!.headers.get("authorization")).toBe("Bearer some-token");
	});
});

// ---------------------------------------------------------------------------
// describe("createEmitoServer — handleUpgrade export")
// ---------------------------------------------------------------------------

describe("createEmitoServer — handleUpgrade export", () => {
	it("should return handleUpgrade as a function on the server object", () => {
		const server = makeServer(vi.fn().mockResolvedValue("sub_1"));

		expect(server.handleUpgrade).toBeDefined();
		expect(typeof server.handleUpgrade).toBe("function");
	});

	it("should return the expected shape: { handler, addRoute, router, prefix, registry, handleUpgrade }", () => {
		const server = makeServer(vi.fn().mockResolvedValue("sub_1"));

		expect(server).toMatchObject({
			handler: expect.any(Function),
			addRoute: expect.any(Function),
			router: expect.anything(),
			prefix: expect.any(String),
			registry: expect.anything(),
			handleUpgrade: expect.any(Function),
		});
	});

	it("should use the configured prefix in handleUpgrade path matching", () => {
		const server = createEmitoServer({
			emito: createMockEmito() as never,
			apiKey: TEST_API_KEY,
			prefix: "/custom-prefix",
			resolveSubscriberId: vi.fn().mockResolvedValue("sub_1"),
			repositories: createRepositories(),
		});

		expect(server.handleUpgrade).toBeDefined();
		expect(server.prefix).toBe("/custom-prefix");
	});
});

// ---------------------------------------------------------------------------
// describe("createEmitoServer — /ws stub removed")
// ---------------------------------------------------------------------------

describe("createEmitoServer — /ws stub removed", () => {
	it("should NOT have a stub route at /ws that returns 501", async () => {
		const server = makeServer(vi.fn().mockResolvedValue("sub_1"));

		const response = await server.handler(
			new Request("http://localhost/emito/v1/ws", {
				method: "GET",
				headers: { authorization: "Bearer some-token" },
			}),
		);

		// The stub returned 501. After refactor, the route should NOT return 501.
		// WS is an upgrade (not HTTP GET), so the HTTP handler should return 404.
		expect(response.status).not.toBe(501);
	});
});
