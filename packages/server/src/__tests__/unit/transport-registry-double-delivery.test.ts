/**
 * Unit tests for double-delivery prevention in ConnectionRegistry.
 *
 * Without guarding, broadcast() calls broadcastLocal() after XADD, then
 * pollStreams() picks up the same event — causing double delivery to local
 * connections.
 *
 * Guard: track locally-written stream IDs in a Set. In pollStreams(), skip
 * events whose stream IDs are in the local set. Clear entries from the set
 * after processing.
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
): Connection & { written: NotificationEvent[]; streamIds: (string | undefined)[] } {
	const written: NotificationEvent[] = [];
	const streamIds: (string | undefined)[] = [];
	return {
		id,
		write(event: NotificationEvent, streamId?: string) {
			written.push(event);
			streamIds.push(streamId);
		},
		close() {},
		get written() {
			return written;
		},
		get streamIds() {
			return streamIds;
		},
	};
}

// ---------------------------------------------------------------------------
// describe("ConnectionRegistry — double-delivery prevention")
// ---------------------------------------------------------------------------

describe("ConnectionRegistry — double-delivery prevention", () => {
	let redis: ReturnType<typeof createMockRedis>;
	let registry: ReturnType<typeof createConnectionRegistry>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		redis = createMockRedis();
		registry = createConnectionRegistry({ redis, pollIntervalMs: 100 });
	});

	afterEach(() => {
		registry.destroy();
		redis.clear();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("broadcast — local delivery", () => {
		it("should deliver the event exactly once via broadcastLocal on first broadcast", async () => {
			const conn = makeConnection("conn_1");
			registry.register("sub_1", conn);

			const event = makeNotificationEvent({ notificationId: "ntf_1" });
			await registry.broadcast("sub_1", event);

			expect(conn.written).toHaveLength(1);
			expect(conn.written[0]).toMatchObject({ notificationId: "ntf_1" });
		});

		it("should write the event to Redis Stream and also deliver locally in the same broadcast call", async () => {
			const conn = makeConnection("conn_1");
			registry.register("sub_1", conn);

			const event = makeNotificationEvent({ notificationId: "ntf_local" });
			await registry.broadcast("sub_1", event);

			// Local delivery should have happened
			expect(conn.written).toHaveLength(1);

			// Redis stream should also have the event
			const entries = await redis.xrange("emito:stream:sub_1", "-", "+");
			expect(entries).toHaveLength(1);
		});
	});

	describe("pollStreams — skip locally-originated events", () => {
		it("should NOT deliver an event a second time when pollStreams picks up a locally-broadcast event", async () => {
			const conn = makeConnection("conn_1");
			registry.register("sub_1", conn);

			const event = makeNotificationEvent({ notificationId: "ntf_b011" });
			await registry.broadcast("sub_1", event);

			// At this point conn.written has 1 event from broadcastLocal.
			// Now trigger a poll cycle — it should NOT re-deliver the same event.
			await vi.advanceTimersByTimeAsync(200); // one poll cycle

			// Still exactly one delivery — not two
			expect(conn.written).toHaveLength(1);
		});

		it("should deliver events from OTHER instances (not locally-originated) via pollStreams", async () => {
			// Setup: broadcast a local event first to establish the stream cursor.
			// The B-011 fix requires that locally-broadcast stream IDs are tracked
			// and that lastReadIds is updated to the local stream ID so pollStreams
			// can subsequently pick up cross-instance events written AFTER it.
			const conn = makeConnection("conn_1");
			registry.register("sub_1", conn);

			// Local broadcast — establishes lastReadIds cursor to this stream ID
			const localEvent = makeNotificationEvent({ notificationId: "ntf_local_anchor" });
			await registry.broadcast("sub_1", localEvent);
			// conn.written has 1 (local broadcast via broadcastLocal)

			// Now write a cross-instance event (simulates another server instance writing to Redis)
			const crossInstanceEvent = makeNotificationEvent({ notificationId: "ntf_cross" });
			await redis.xadd("emito:stream:sub_1", "*", "event", JSON.stringify(crossInstanceEvent));

			// Trigger poll cycle — should pick up ntf_cross (not locally-originated)
			// and skip ntf_local_anchor (locally-originated, in localStreamIds set)
			await vi.advanceTimersByTimeAsync(200);

			// Should now have: 1 local + 1 cross-instance = 2 deliveries
			expect(conn.written).toHaveLength(2);
			const notifIds = conn.written.map((e) => e.notificationId);
			expect(notifIds).toContain("ntf_local_anchor");
			expect(notifIds).toContain("ntf_cross");
		});

		it("should clear the local stream ID set entry after the poll cycle processes (or skips) it", async () => {
			const conn = makeConnection("conn_1");
			registry.register("sub_1", conn);

			// First broadcast
			const event1 = makeNotificationEvent({ notificationId: "ntf_seq_1" });
			await registry.broadcast("sub_1", event1);

			// Allow poll to run — should skip event1
			await vi.advanceTimersByTimeAsync(200);

			expect(conn.written).toHaveLength(1);

			// Second broadcast — should deliver again (not affected by cleared set)
			const event2 = makeNotificationEvent({ notificationId: "ntf_seq_2" });
			await registry.broadcast("sub_1", event2);

			// Allow poll for event2
			await vi.advanceTimersByTimeAsync(200);

			// Exactly 2 deliveries total
			expect(conn.written).toHaveLength(2);
			expect(conn.written[1]).toMatchObject({ notificationId: "ntf_seq_2" });
		});

		it("should not double-deliver when multiple subscribers have local connections", async () => {
			const conn1 = makeConnection("conn_sub1");
			const conn2 = makeConnection("conn_sub2");
			registry.register("sub_1", conn1);
			registry.register("sub_2", conn2);

			const event1 = makeNotificationEvent({ notificationId: "ntf_sub1" });
			const event2 = makeNotificationEvent({ notificationId: "ntf_sub2" });

			await registry.broadcast("sub_1", event1);
			await registry.broadcast("sub_2", event2);

			// Trigger poll cycles
			await vi.advanceTimersByTimeAsync(300);

			// Each subscriber's connection should receive exactly one delivery
			expect(conn1.written).toHaveLength(1);
			expect(conn2.written).toHaveLength(1);
		});
	});

	describe("graceful degradation — no Redis", () => {
		it("should still deliver exactly once via broadcastLocal when Redis is not configured", async () => {
			const noRedisRegistry = createConnectionRegistry({ redis: undefined });
			const conn = makeConnection("conn_nr");
			noRedisRegistry.register("sub_1", conn);

			const event = makeNotificationEvent({ notificationId: "ntf_nored" });
			await noRedisRegistry.broadcast("sub_1", event);

			// No poll timer without Redis, so only one delivery
			expect(conn.written).toHaveLength(1);
			noRedisRegistry.destroy();
		});
	});
});
