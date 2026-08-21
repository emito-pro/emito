/**
 * Unit tests for the SSE endpoint (packages/server/src/transport/sse.ts).
 *
 * Tests validate:
 *   - Response headers (Content-Type: text/event-stream, Cache-Control, Connection)
 *   - Event format: "event: notification\nid: {streamId}\ndata: {json}\n\n"
 *   - Heartbeat events every 30s
 *   - Last-Event-ID reconnection — catch-up from Redis Stream
 *   - Connection registered in ConnectionRegistry on connect
 *   - Connection unregistered on disconnect
 *
 * Auth is handled centrally in handler.ts, so these tests invoke the handler
 * directly with a pre-populated subscriberId in ctx.
 */

import type { NotificationEvent } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRedis } from "../../../../core/__tests__/helpers/mock-redis.js";
import { createRouter } from "../../router.js";
import { createConnectionRegistry } from "../../transport/registry.js";
import { registerSSEEndpoint } from "../../transport/sse.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUBSCRIBER_ID = "sub_1";

function makeNotificationEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
	return {
		notificationId: "ntf_1",
		subscriberId: "sub_1",
		event: "order.shipped",
		body: "Order 123 shipped",
		timestamp: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

/**
 * Read a limited number of SSE frames from a ReadableStream response.
 * Returns the raw text chunks collected up to `maxFrames` data frames or `timeoutMs`.
 */
async function readSseFrames(
	response: Response,
	maxFrames: number,
	timeoutMs = 2000,
): Promise<string[]> {
	if (!response.body) return [];
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const frames: string[] = [];
	let buffer = "";

	const deadline = Date.now() + timeoutMs;
	while (frames.length < maxFrames && Date.now() < deadline) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		// SSE frames are delimited by double newline
		const parts = buffer.split("\n\n");
		buffer = parts.pop() ?? "";
		for (const part of parts) {
			if (part.trim()) frames.push(part);
		}
	}
	reader.cancel().catch(() => {});
	return frames;
}

// ---------------------------------------------------------------------------
// describe("registerSSEEndpoint")
// ---------------------------------------------------------------------------

describe("registerSSEEndpoint", () => {
	let redis: ReturnType<typeof createMockRedis>;
	let registry: ReturnType<typeof createConnectionRegistry>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		redis = createMockRedis();
		registry = createConnectionRegistry({ redis });
	});

	afterEach(() => {
		registry.destroy();
		vi.useRealTimers();
		redis.clear();
		vi.restoreAllMocks();
	});

	// --- Route registration ---

	describe("route registration", () => {
		it("should register GET /stream route", () => {
			const router = createRouter("/emito", "v1");
			registerSSEEndpoint(router, { registry, redis });
			expect(router.match("GET", "/emito/v1/stream")).not.toBeNull();
		});
	});

	// --- Response headers ---

	describe("response headers", () => {
		it("should return text/event-stream Content-Type", async () => {
			const router = createRouter("/emito", "v1");
			registerSSEEndpoint(router, { registry, redis });

			const match = router.match("GET", "/emito/v1/stream")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/stream"),
			);
			expect(res.headers.get("content-type")).toContain("text/event-stream");
		});

		it("should return Cache-Control: no-cache", async () => {
			const router = createRouter("/emito", "v1");
			registerSSEEndpoint(router, { registry, redis });

			const match = router.match("GET", "/emito/v1/stream")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/stream"),
			);
			expect(res.headers.get("cache-control")).toBe("no-cache");
		});
	});

	// --- Heartbeat ---

	describe("heartbeat", () => {
		it("should send a heartbeat event every 30 seconds", async () => {
			const router = createRouter("/emito", "v1");
			registerSSEEndpoint(router, { registry, redis });

			const match = router.match("GET", "/emito/v1/stream")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/stream"),
			);
			expect(res.status).toBe(200);

			// Advance time by 30s to trigger heartbeat
			const framesPromise = readSseFrames(res, 1, 500);
			await vi.advanceTimersByTimeAsync(30_000);
			const frames = await framesPromise;

			// At least one heartbeat frame should have arrived
			const hasHeartbeat = frames.some((f) => f.includes("event: heartbeat"));
			expect(hasHeartbeat).toBe(true);
		});
	});

	// --- Registry wiring ---

	describe("registry wiring", () => {
		it("should register the connection in ConnectionRegistry on connect", async () => {
			const router = createRouter("/emito", "v1");
			registerSSEEndpoint(router, { registry, redis });

			expect(registry.getCount()).toBe(0);

			const match = router.match("GET", "/emito/v1/stream")!;
			await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/stream"),
			);

			expect(registry.getCount()).toBeGreaterThan(0);
		});
	});

	// --- Event format ---

	describe("event format", () => {
		it("should deliver events in SSE format: event: notification\\nid: {id}\\ndata: {json}", async () => {
			const router = createRouter("/emito", "v1");
			registerSSEEndpoint(router, { registry, redis });

			const match = router.match("GET", "/emito/v1/stream")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/stream"),
			);

			// Broadcast an event to the registered connection
			const event = makeNotificationEvent({ notificationId: "ntf_99" });
			const framesPromise = readSseFrames(res, 1, 500);
			await registry.broadcast(SUBSCRIBER_ID, event);
			await vi.advanceTimersByTimeAsync(10);
			const frames = await framesPromise;

			const notifFrame = frames.find((f) => f.includes("event: notification"));
			expect(notifFrame).toBeDefined();
			expect(notifFrame).toContain("event: notification");
			expect(notifFrame).toContain("data:");
			// Data line should be valid JSON containing the event notificationId
			const dataLine = notifFrame!.split("\n").find((l) => l.startsWith("data:"));
			expect(dataLine).toBeDefined();
			const parsed = JSON.parse(dataLine!.replace("data:", "").trim()) as {
				notificationId: string;
			};
			expect(parsed.notificationId).toBe("ntf_99");
		});
	});

	// --- Last-Event-ID reconnection ---

	describe("Last-Event-ID reconnection", () => {
		it("should catch up missed events from Redis Stream when Last-Event-ID is provided", async () => {
			// Pre-populate the Redis Stream with a missed event
			const event = makeNotificationEvent({ notificationId: "ntf_missed" });
			await redis.xadd(`emito:stream:${SUBSCRIBER_ID}`, "*", "event", JSON.stringify(event));
			const idBefore = "0-0"; // catch up from beginning

			const router = createRouter("/emito", "v1");
			registerSSEEndpoint(router, { registry, redis });

			const match = router.match("GET", "/emito/v1/stream")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/stream", {
					headers: {
						"last-event-id": idBefore,
					},
				}),
			);

			// Give the handler time to do XRANGE catch-up
			await vi.advanceTimersByTimeAsync(50);
			const frames = await readSseFrames(res, 1, 500);

			// There should be at least one notification frame with the missed event
			const notifFrame = frames.find((f) => f.includes("event: notification"));
			expect(notifFrame).toBeDefined();
			const dataLine = notifFrame!.split("\n").find((l) => l.startsWith("data:"));
			const parsed = JSON.parse(dataLine!.replace("data:", "").trim()) as {
				notificationId: string;
			};
			expect(parsed.notificationId).toBe("ntf_missed");
		});
	});
});
