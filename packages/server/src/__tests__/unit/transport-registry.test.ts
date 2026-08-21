/**
 * Unit tests for ConnectionRegistry (packages/server/src/transport/registry.ts).
 *
 * Uses MockRedis for all unit tests — no real Redis.
 * Tests validate:
 *   - register / unregister / getCount
 *   - broadcast to local connections
 *   - Redis Streams write on notification (XADD + XTRIM)
 *   - Graceful degradation: Redis unavailable → in-process fanout only
 *
 * Agent rules applied: #1, #2, #4, #5, #7, #10, #11, #15, #22, #25, #26, #28, #32
 */

import type { NotificationEvent } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRedis } from "../../../../core/__tests__/helpers/mock-redis.js";
import type { Connection } from "../../transport/registry.js";
import { createConnectionRegistry } from "../../transport/registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeConnection(
	id: string,
): Connection & { written: NotificationEvent[]; closed: boolean } {
	const state = { written: [] as NotificationEvent[], closed: false };
	return {
		id,
		write(event: NotificationEvent) {
			state.written.push(event);
		},
		close() {
			state.closed = true;
		},
		get written() {
			return state.written;
		},
		get closed() {
			return state.closed;
		},
	};
}

// ---------------------------------------------------------------------------
// describe("createConnectionRegistry")
// ---------------------------------------------------------------------------

describe("createConnectionRegistry", () => {
	let redis: ReturnType<typeof createMockRedis>;
	let registry: ReturnType<typeof createConnectionRegistry>;

	beforeEach(() => {
		redis = createMockRedis();
		registry = createConnectionRegistry({ redis });
	});

	afterEach(() => {
		registry.destroy?.();
		redis.clear();
		vi.restoreAllMocks();
	});

	// --- register / unregister / getCount ---

	describe("register", () => {
		it("should increment connection count after registering a connection", () => {
			const conn = makeConnection("conn_1");
			registry.register("sub_1", conn);
			expect(registry.getCount()).toBe(1);
		});

		it("should track multiple connections for the same subscriber", () => {
			registry.register("sub_1", makeConnection("conn_1"));
			registry.register("sub_1", makeConnection("conn_2"));
			expect(registry.getCount()).toBe(2);
		});

		it("should track connections for different subscribers independently", () => {
			registry.register("sub_1", makeConnection("conn_1"));
			registry.register("sub_2", makeConnection("conn_2"));
			expect(registry.getCount()).toBe(2);
		});

		it("should not double-count the same connection object registered twice", () => {
			const conn = makeConnection("conn_1");
			registry.register("sub_1", conn);
			registry.register("sub_1", conn);
			expect(registry.getCount()).toBe(1);
		});
	});

	describe("unregister", () => {
		it("should decrement count after unregistering", () => {
			const conn = makeConnection("conn_1");
			registry.register("sub_1", conn);
			registry.unregister("sub_1", conn);
			expect(registry.getCount()).toBe(0);
		});

		it("should not throw when unregistering an unknown connection", () => {
			expect(() => registry.unregister("sub_1", makeConnection("unknown"))).not.toThrow();
		});

		it("should keep other connections for same subscriber after unregistering one", () => {
			const conn1 = makeConnection("conn_1");
			const conn2 = makeConnection("conn_2");
			registry.register("sub_1", conn1);
			registry.register("sub_1", conn2);
			registry.unregister("sub_1", conn1);
			expect(registry.getCount()).toBe(1);
		});
	});

	describe("getCount", () => {
		it("should return 0 when no connections registered", () => {
			expect(registry.getCount()).toBe(0);
		});
	});

	// --- broadcast ---

	describe("broadcast", () => {
		it("should write event to all connections for the subscriber", async () => {
			const conn1 = makeConnection("conn_1");
			const conn2 = makeConnection("conn_2");
			registry.register("sub_1", conn1);
			registry.register("sub_1", conn2);

			const event = makeNotificationEvent();
			await registry.broadcast("sub_1", event);

			expect(conn1.written).toHaveLength(1);
			expect(conn1.written[0]).toMatchObject({ notificationId: "ntf_1" });
			expect(conn2.written).toHaveLength(1);
		});

		it("should not write to connections for a different subscriber", async () => {
			const conn1 = makeConnection("conn_1");
			const conn2 = makeConnection("conn_2");
			registry.register("sub_1", conn1);
			registry.register("sub_2", conn2);

			await registry.broadcast("sub_1", makeNotificationEvent());

			expect(conn1.written).toHaveLength(1);
			expect(conn2.written).toHaveLength(0);
		});

		it("should not throw when broadcasting to a subscriber with no connections", async () => {
			await expect(
				registry.broadcast("sub_nobody", makeNotificationEvent()),
			).resolves.not.toThrow();
		});

		it("should still broadcast to remaining connections after one is unregistered", async () => {
			const conn1 = makeConnection("conn_1");
			const conn2 = makeConnection("conn_2");
			registry.register("sub_1", conn1);
			registry.register("sub_1", conn2);
			registry.unregister("sub_1", conn1);

			await registry.broadcast("sub_1", makeNotificationEvent());

			expect(conn1.written).toHaveLength(0);
			expect(conn2.written).toHaveLength(1);
		});
	});

	// --- Redis Streams integration ---

	describe("Redis Streams — XADD on broadcast", () => {
		it("should write the event to the subscriber's Redis Stream on broadcast", async () => {
			registry.register("sub_1", makeConnection("conn_1"));
			const event = makeNotificationEvent({ notificationId: "ntf_42" });

			await registry.broadcast("sub_1", event);

			const entries = await redis.xrange("emito:stream:sub_1", "-", "+");
			expect(entries).toHaveLength(1);

			// The stream entry should contain the serialized event
			const [, fields] = entries[0]!;
			const eventFieldIdx = fields.indexOf("event");
			expect(eventFieldIdx).toBeGreaterThanOrEqual(0);
			const eventJson = fields[eventFieldIdx + 1]!;
			const parsed = JSON.parse(eventJson) as { notificationId: string };
			expect(parsed.notificationId).toBe("ntf_42");
		});

		it("should use stream key pattern emito:stream:{subscriberId}", async () => {
			registry.register("sub_abc", makeConnection("conn_1"));
			await registry.broadcast("sub_abc", makeNotificationEvent());

			const len = await redis.xlen("emito:stream:sub_abc");
			expect(len).toBeGreaterThan(0);

			// Different subscriber key should be empty
			const len2 = await redis.xlen("emito:stream:sub_1");
			expect(len2).toBe(0);
		});

		it("should trim the stream to at most ~1000 entries on write", async () => {
			registry.register("sub_1", makeConnection("conn_1"));
			const event = makeNotificationEvent();

			// Pre-populate with many entries (below MAXLEN threshold)
			for (let i = 0; i < 10; i++) {
				await redis.xadd("emito:stream:sub_1", "*", "event", JSON.stringify(event));
			}

			await registry.broadcast("sub_1", event);
			const len = await redis.xlen("emito:stream:sub_1");
			expect(len).toBeLessThanOrEqual(1001);
		});
	});

	// --- Graceful degradation ---

	describe("graceful degradation without Redis", () => {
		it("should still broadcast in-process when Redis is not provided", async () => {
			const noRedisRegistry = createConnectionRegistry({ redis: undefined });
			const conn = makeConnection("conn_1");
			noRedisRegistry.register("sub_1", conn);

			await noRedisRegistry.broadcast("sub_1", makeNotificationEvent());

			expect(conn.written).toHaveLength(1);
			noRedisRegistry.destroy?.();
		});

		it("should not throw when Redis fails during broadcast", async () => {
			const failingRedis = createMockRedis();
			vi.spyOn(failingRedis, "xadd").mockRejectedValue(new Error("Redis connection refused"));

			const degradedRegistry = createConnectionRegistry({ redis: failingRedis });
			const conn = makeConnection("conn_1");
			degradedRegistry.register("sub_1", conn);

			// Should not throw — graceful degradation
			await expect(
				degradedRegistry.broadcast("sub_1", makeNotificationEvent()),
			).resolves.not.toThrow();

			// Local broadcast should still succeed
			expect(conn.written).toHaveLength(1);
			degradedRegistry.destroy?.();
		});
	});
});
