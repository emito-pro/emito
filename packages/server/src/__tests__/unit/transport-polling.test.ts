/**
 * Unit tests for the polling endpoint (packages/server/src/transport/polling.ts).
 *
 * Tests validate:
 *   - Returns events since last poll ID (XRANGE from `since` param)
 *   - Returns latest events when no `since` param provided
 *   - Standard JSON collection envelope
 *   - Empty array when no events exist
 *   - Boundary: `since` ID that doesn't exist returns from latest
 *   - Graceful degradation when Redis unavailable
 *
 * Auth is handled centrally in handler.ts, so these tests invoke the handler
 * directly with a pre-populated subscriberId in ctx.
 */

import type { NotificationEvent } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRedis } from "../../../../core/__tests__/helpers/mock-redis.js";
import { createRouter } from "../../router.js";
import { registerPollingEndpoint } from "../../transport/polling.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUBSCRIBER_ID = "sub_1";

function makeNotificationEvent(
	notificationId: string,
	overrides: Partial<NotificationEvent> = {},
): NotificationEvent {
	return {
		notificationId,
		subscriberId: "sub_1",
		event: "order.shipped",
		body: "Order 123 shipped",
		timestamp: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

async function addEventToStream(
	redis: ReturnType<typeof createMockRedis>,
	subscriberId: string,
	event: NotificationEvent,
): Promise<string> {
	return redis.xadd(`emito:stream:${subscriberId}`, "*", "event", JSON.stringify(event));
}

// ---------------------------------------------------------------------------
// describe("registerPollingEndpoint")
// ---------------------------------------------------------------------------

describe("registerPollingEndpoint", () => {
	let redis: ReturnType<typeof createMockRedis>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		redis = createMockRedis();
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
		vi.restoreAllMocks();
	});

	// --- Route registration ---

	describe("route registration", () => {
		it("should register GET /poll route", () => {
			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });
			expect(router.match("GET", "/emito/v1/poll")).not.toBeNull();
		});
	});

	// --- Response envelope ---

	describe("response envelope", () => {
		it("should return JSON with standard collection envelope { data: { items, hasMore } }", async () => {
			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/poll"),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("application/json");

			const body = (await res.json()) as { data: { items: unknown[]; hasMore: boolean } };
			expect(body.data).toBeDefined();
			expect(Array.isArray(body.data.items)).toBe(true);
			expect(typeof body.data.hasMore).toBe("boolean");
		});

		it("should return empty items array when no events exist", async () => {
			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/poll"),
			);
			const body = (await res.json()) as { data: { items: unknown[] } };
			expect(body.data.items).toHaveLength(0);
		});
	});

	// --- Since parameter ---

	describe("since parameter", () => {
		it("should return events after the provided since ID", async () => {
			const event1 = makeNotificationEvent("ntf_1");
			const event2 = makeNotificationEvent("ntf_2");
			const streamId1 = await addEventToStream(redis, SUBSCRIBER_ID, event1);
			await addEventToStream(redis, SUBSCRIBER_ID, event2);

			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request(`http://localhost/emito/v1/poll?since=${streamId1}`),
			);
			const body = (await res.json()) as { data: { items: Array<{ event: NotificationEvent }> } };
			// Should only include event2 (since excludes streamId1 itself)
			expect(body.data.items).toHaveLength(1);
			expect(body.data.items[0]!.event.notificationId).toBe("ntf_2");
		});

		it("should return all events when since is not provided", async () => {
			await addEventToStream(redis, SUBSCRIBER_ID, makeNotificationEvent("ntf_1"));
			await addEventToStream(redis, SUBSCRIBER_ID, makeNotificationEvent("ntf_2"));

			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/poll"),
			);
			const body = (await res.json()) as { data: { items: unknown[] } };
			expect(body.data.items.length).toBeGreaterThanOrEqual(2);
		});

		it("should return empty items when since is the last event ID", async () => {
			const event = makeNotificationEvent("ntf_1");
			const lastId = await addEventToStream(redis, SUBSCRIBER_ID, event);

			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request(`http://localhost/emito/v1/poll?since=${lastId}`),
			);
			const body = (await res.json()) as { data: { items: unknown[] } };
			expect(body.data.items).toHaveLength(0);
		});

		it("should only return events for the authenticated subscriber", async () => {
			// Add events for two different subscribers
			await addEventToStream(redis, "sub_1", makeNotificationEvent("ntf_sub1"));
			await addEventToStream(redis, "sub_2", makeNotificationEvent("ntf_sub2"));

			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: "sub_1" } as never,
				new Request("http://localhost/emito/v1/poll"),
			);
			const body = (await res.json()) as {
				data: { items: Array<{ event: NotificationEvent }> };
			};
			// Should only return sub_1's events
			expect(body.data.items.every((item) => item.event.notificationId === "ntf_sub1")).toBe(true);
		});
	});

	// --- Boundary conditions ---

	describe("boundary conditions", () => {
		it("should handle since=0-0 (fetch from beginning)", async () => {
			await addEventToStream(redis, SUBSCRIBER_ID, makeNotificationEvent("ntf_1"));

			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/poll?since=0-0"),
			);
			const body = (await res.json()) as { data: { items: unknown[] } };
			expect(body.data.items.length).toBeGreaterThanOrEqual(1);
		});

		it("should not throw for empty string since param (treat as no since)", async () => {
			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/poll?since="),
			);
			expect([200, 400]).toContain(res.status);
		});
	});

	// --- Graceful degradation ---

	describe("graceful degradation", () => {
		it("should return 503 when Redis is not provided", async () => {
			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis: undefined });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/poll"),
			);
			expect(res.status).toBe(503);
		});

		it("should return 503 when Redis xrange fails", async () => {
			vi.spyOn(redis, "xrange").mockRejectedValue(new Error("Redis unavailable"));

			const router = createRouter("/emito", "v1");
			registerPollingEndpoint(router, { redis });

			const match = router.match("GET", "/emito/v1/poll")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined, subscriberId: SUBSCRIBER_ID } as never,
				new Request("http://localhost/emito/v1/poll"),
			);
			expect(res.status).toBe(503);
		});
	});
});
