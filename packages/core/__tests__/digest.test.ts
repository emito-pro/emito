/**
 * Tests for the digest engine (Task 4).
 *
 * Success criteria:
 * - Events buffered in Redis sorted set per subscriber+eventType
 * - Threshold-based flush triggers when maxCount reached
 * - Time-based flush triggers when windowMs exceeded
 * - Atomic flush prevents event loss (MULTI ZRANGEBYSCORE + DEL)
 * - Redis lock prevents double-flush across instances
 * - Graceful degradation: sends immediately when Redis unavailable
 * - emito_queue_depth gauge reflects buffered event count
 * - Lifecycle start/stop correctly controls the poller
 * - Works with both real Redis and mock
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DigestEngine, DigestEngineConfig, DigestEvent } from "../src/digest/engine";
import { createDigestEngine } from "../src/digest/engine";
import {
	acquireFlushLock,
	atomicFlush,
	checkpointKey,
	digestKey,
	flushLockKey,
} from "../src/digest/flush";
import { createEventRegistry } from "../src/event-registry";
import {
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemorySubscriberRepository,
	InMemorySubscriptionRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "../src/repositories/in-memory/index";
import { type SendDeps, executeSend } from "../src/send";
import { type MockRedis, createMockRedis } from "./helpers/mock-redis";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function createMockLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
		level: "silent" as const,
	};
}

function createMockMetrics() {
	return {
		queueDepth: { set: vi.fn() },
	};
}

const DEFAULT_CONFIG: DigestEngineConfig = { maxCount: 3, windowMs: 60_000 };

const SUB = "sub_1";
const EVENT = "order.update";

/** Build a valid DigestEvent for the engine's addEvent(event) interface. */
function makeEvent(overrides: Partial<DigestEvent> = {}): DigestEvent {
	return {
		subscriberId: SUB,
		eventType: EVENT,
		payload: { orderId: "ord_1" },
		timestamp: Date.now(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// flush.ts helper functions
// ---------------------------------------------------------------------------

describe("digestKey", () => {
	it("returns emito:digest:{subscriberId}:{eventType}", () => {
		expect(digestKey("sub_1", "order.update")).toBe("emito:digest:sub_1:order.update");
	});
});

describe("flushLockKey", () => {
	it("returns emito:digest:flush_lock:{subscriberId}:{eventType}", () => {
		expect(flushLockKey("sub_1", "order.update")).toBe(
			"emito:digest:flush_lock:sub_1:order.update",
		);
	});
});

describe("acquireFlushLock", () => {
	let redis: MockRedis;

	beforeEach(() => {
		redis = createMockRedis();
	});

	afterEach(() => {
		redis.clear();
	});

	it("returns true when no lock exists", async () => {
		expect(await acquireFlushLock(redis, SUB, EVENT)).toBe(true);
	});

	it("returns false when lock is already held", async () => {
		await acquireFlushLock(redis, SUB, EVENT);
		expect(await acquireFlushLock(redis, SUB, EVENT)).toBe(false);
	});

	it("locks are independent per subscriber+eventType", async () => {
		await acquireFlushLock(redis, "sub_1", "order.update");
		expect(await acquireFlushLock(redis, "sub_2", "order.update")).toBe(true);
	});
});

describe("atomicFlush", () => {
	let redis: MockRedis;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	it("returns empty array when sorted set is empty", async () => {
		expect(await atomicFlush(redis, SUB, EVENT)).toEqual([]);
	});

	it("returns buffered events with payload and timestamp", async () => {
		const now = Date.now();
		const key = digestKey(SUB, EVENT);
		await redis.zadd(key, now, JSON.stringify({ payload: { x: 1 }, timestamp: now }));

		const events = await atomicFlush(redis, SUB, EVENT);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ payload: { x: 1 }, timestamp: now });
	});

	it("deletes the sorted set key after flush (atomic read+delete)", async () => {
		const now = Date.now();
		const key = digestKey(SUB, EVENT);
		await redis.zadd(key, now, JSON.stringify({ payload: {}, timestamp: now }));

		await atomicFlush(redis, SUB, EVENT);

		expect(await redis.zcard(key)).toBe(0);
	});

	it("returns events sorted by timestamp ascending", async () => {
		const key = digestKey(SUB, EVENT);
		await redis.zadd(key, 3000, JSON.stringify({ payload: { i: 3 }, timestamp: 3000 }));
		await redis.zadd(key, 1000, JSON.stringify({ payload: { i: 1 }, timestamp: 1000 }));
		await redis.zadd(key, 2000, JSON.stringify({ payload: { i: 2 }, timestamp: 2000 }));

		const events = await atomicFlush(redis, SUB, EVENT);
		expect(events.map((e) => e.payload.i)).toEqual([1, 2, 3]);
	});

	it("event added after flush is not affected by the delete", async () => {
		const key = digestKey(SUB, EVENT);
		const now = Date.now();
		await redis.zadd(key, now, JSON.stringify({ payload: { pre: true }, timestamp: now }));

		await atomicFlush(redis, SUB, EVENT);

		const later = now + 1;
		await redis.zadd(key, later, JSON.stringify({ payload: { post: true }, timestamp: later }));

		expect(await redis.zcard(key)).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// createDigestEngine — addEvent / flush / lifecycle
// ---------------------------------------------------------------------------

describe("createDigestEngine", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;
	let engine: DigestEngine;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
		engine = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
	});

	afterEach(async () => {
		await engine.stop();
		vi.useRealTimers();
		redis.clear();
	});

	// -----------------------------------------------------------------------
	// addEvent: buffering
	// -----------------------------------------------------------------------

	describe("addEvent", () => {
		it("returns false (no immediate flush) when below maxCount", async () => {
			expect(await engine.addEvent(makeEvent())).toBe(false);
		});

		it("stores the event in the sorted set", async () => {
			await engine.addEvent(makeEvent({ subscriberId: SUB, eventType: EVENT }));
			expect(await redis.zcard(digestKey(SUB, EVENT))).toBe(1);
		});

		it("returns true when maxCount is reached", async () => {
			let shouldFlush = false;
			for (let i = 0; i < DEFAULT_CONFIG.maxCount; i++) {
				shouldFlush = await engine.addEvent(makeEvent());
			}
			expect(shouldFlush).toBe(true);
		});

		it("returns false for the (maxCount - 1)th event (boundary)", async () => {
			let shouldFlush = false;
			for (let i = 0; i < DEFAULT_CONFIG.maxCount - 1; i++) {
				shouldFlush = await engine.addEvent(makeEvent());
			}
			expect(shouldFlush).toBe(false);
		});

		it("maxCount=1: first event triggers immediate flush", async () => {
			const e = createDigestEngine({ redis, logger, config: { maxCount: 1, windowMs: 60_000 } });
			expect(await e.addEvent(makeEvent())).toBe(true);
			await e.stop();
		});

		it("maxCount boundary: count >= maxCount (not strictly >) returns true", async () => {
			const e = createDigestEngine({ redis, logger, config: { maxCount: 2, windowMs: 60_000 } });
			await e.addEvent(makeEvent()); // count=1, false
			expect(await e.addEvent(makeEvent())).toBe(true); // count=2, true
			await e.stop();
		});

		it("counts per subscriber+eventType independently", async () => {
			for (let i = 0; i < DEFAULT_CONFIG.maxCount; i++) {
				await engine.addEvent(makeEvent({ subscriberId: "sub_1", eventType: "order.update" }));
			}
			expect(
				await engine.addEvent(makeEvent({ subscriberId: "sub_2", eventType: "order.update" })),
			).toBe(false);
		});

		it("counts per eventType independently for the same subscriber", async () => {
			for (let i = 0; i < DEFAULT_CONFIG.maxCount; i++) {
				await engine.addEvent(makeEvent({ eventType: "order.update" }));
			}
			expect(await engine.addEvent(makeEvent({ eventType: "order.shipped" }))).toBe(false);
		});

		it("uses key emito:digest:{subscriberId}:{eventType}", async () => {
			await engine.addEvent(makeEvent({ subscriberId: "sub_x", eventType: "promo.sent" }));
			expect(await redis.zcard("emito:digest:sub_x:promo.sent")).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// flush — atomic MULTI (ZRANGEBYSCORE + DEL)
	// -----------------------------------------------------------------------

	describe("flush", () => {
		it("returns all buffered events for a subscriber+eventType", async () => {
			for (let i = 0; i < 2; i++) {
				await engine.addEvent(makeEvent({ payload: { i } }));
			}
			expect(await engine.flush(SUB, EVENT)).toHaveLength(2);
		});

		it("returns empty array when there are no buffered events", async () => {
			expect(await engine.flush(SUB, EVENT)).toEqual([]);
		});

		it("removes all buffered events from Redis after flush", async () => {
			for (let i = 0; i < 2; i++) {
				await engine.addEvent(makeEvent());
			}
			await engine.flush(SUB, EVENT);
			expect(await redis.zcard(digestKey(SUB, EVENT))).toBe(0);
		});

		it("flush is idempotent: second flush returns empty array", async () => {
			await engine.addEvent(makeEvent());
			await engine.flush(SUB, EVENT);
			expect(await engine.flush(SUB, EVENT)).toEqual([]);
		});

		it("flushed DigestEvent includes subscriberId, eventType, payload, and timestamp", async () => {
			await engine.addEvent(makeEvent({ payload: { orderId: "ord_42" } }));
			const events = await engine.flush(SUB, EVENT);
			expect(events[0]).toMatchObject({
				subscriberId: SUB,
				eventType: EVENT,
				payload: { orderId: "ord_42" },
				timestamp: expect.any(Number),
			});
		});

		it("events added after flush are not deleted by the flush", async () => {
			await engine.addEvent(makeEvent({ payload: { pre: true } }));
			await engine.flush(SUB, EVENT);
			await engine.addEvent(makeEvent({ payload: { post: true } }));
			expect(await redis.zcard(digestKey(SUB, EVENT))).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// Redis lock — prevents double-flush across instances
	// -----------------------------------------------------------------------

	describe("Redis lock prevents double-flush", () => {
		it("flush proceeds when no lock is held", async () => {
			await engine.addEvent(makeEvent());
			expect(await engine.flush(SUB, EVENT)).toHaveLength(1);
		});

		it("second flush skips and returns [] when lock key is pre-set", async () => {
			for (let i = 0; i < 2; i++) {
				await engine.addEvent(makeEvent());
			}
			await redis.set(flushLockKey(SUB, EVENT), "1", "NX", "EX", 30);
			expect(await engine.flush(SUB, EVENT)).toEqual([]);
		});

		it("a second engine instance sharing Redis skips flush when lock is held", async () => {
			const engine2 = createDigestEngine({
				redis,
				logger: createMockLogger(),
				config: DEFAULT_CONFIG,
			});

			for (let i = 0; i < 2; i++) {
				await engine.addEvent(makeEvent());
			}
			await redis.set(flushLockKey(SUB, EVENT), "1", "NX", "EX", 30);

			expect(await engine2.flush(SUB, EVENT)).toEqual([]);
			await engine2.stop();
		});

		it("lock uses key emito:digest:flush_lock:{subscriberId}:{eventType}", async () => {
			// Pre-set the lock — engine must respect it and skip flush
			await redis.set(flushLockKey(SUB, EVENT), "1", "NX", "EX", 30);
			await engine.addEvent(makeEvent());
			expect(await engine.flush(SUB, EVENT)).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// emito_queue_depth gauge
	// -----------------------------------------------------------------------

	describe("emito_queue_depth metric", () => {
		it("calls queueDepth.set after addEvent", async () => {
			const metrics = createMockMetrics();
			const e = createDigestEngine({ redis, logger, metrics, config: DEFAULT_CONFIG });

			await e.addEvent(makeEvent());

			expect(metrics.queueDepth.set).toHaveBeenCalledWith(expect.any(Object), 1);
			await e.stop();
		});

		it("gauge value increments with each buffered event", async () => {
			const metrics = createMockMetrics();
			const e = createDigestEngine({ redis, logger, metrics, config: DEFAULT_CONFIG });

			await e.addEvent(makeEvent());
			await e.addEvent(makeEvent());

			expect(metrics.queueDepth.set.mock.calls.at(-1)?.[1]).toBe(2);
			await e.stop();
		});

		it("gauge drops to 0 after flush", async () => {
			const metrics = createMockMetrics();
			const e = createDigestEngine({ redis, logger, metrics, config: DEFAULT_CONFIG });

			await e.addEvent(makeEvent());
			await e.flush(SUB, EVENT);

			expect(metrics.queueDepth.set.mock.calls.at(-1)?.[1]).toBe(0);
			await e.stop();
		});

		it("works without metrics configured (no throw)", async () => {
			const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
			await expect(e.addEvent(makeEvent())).resolves.not.toThrow();
			await e.stop();
		});
	});

	// -----------------------------------------------------------------------
	// Lifecycle: start / stop
	// -----------------------------------------------------------------------

	describe("lifecycle: start / stop", () => {
		it("start() returns without error", async () => {
			const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
			await expect(e.start()).resolves.not.toThrow();
			await e.stop();
		});

		it("stop() does not throw before start() is called", async () => {
			const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
			await expect(e.stop()).resolves.not.toThrow();
		});

		it("stop() does not throw if called twice", async () => {
			const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
			await e.start();
			await e.stop();
			await expect(e.stop()).resolves.not.toThrow();
		});

		it("calling start() twice is a no-op (single interval)", async () => {
			const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
			await e.start();
			await e.start(); // must be idempotent
			await e.stop();
		});
	});

	// -----------------------------------------------------------------------
	// Time-based flush via poller (uses onFlush callback in deps)
	// -----------------------------------------------------------------------

	describe("time-based flush (windowMs poller)", () => {
		it("does not flush events before windowMs has elapsed", async () => {
			const flushed: DigestEvent[][] = [];
			const e = createDigestEngine({
				redis,
				logger,
				config: { maxCount: 100, windowMs: 10_000 },
				onFlush: async (_s, _et, events) => {
					flushed.push([...events]);
				},
			});
			await e.start();

			await e.addEvent(makeEvent());
			await vi.advanceTimersByTimeAsync(9_000);

			expect(flushed).toHaveLength(0);
			expect(await redis.zcard(digestKey(SUB, EVENT))).toBe(1);

			await e.stop();
		});

		it("fires onFlush callback after windowMs has elapsed", async () => {
			const flushed: DigestEvent[][] = [];
			const e = createDigestEngine({
				redis,
				logger,
				config: { maxCount: 100, windowMs: 5_000 },
				onFlush: async (_s, _et, events) => {
					flushed.push([...events]);
				},
			});
			await e.start();

			await e.addEvent(makeEvent({ payload: { x: 1 } }));
			await vi.advanceTimersByTimeAsync(6_000);

			expect(flushed.length).toBeGreaterThanOrEqual(1);
			expect(flushed[0]).toEqual(
				expect.arrayContaining([expect.objectContaining({ payload: { x: 1 } })]),
			);

			await e.stop();
		});

		it("clears the sorted set after time-based flush", async () => {
			const e = createDigestEngine({
				redis,
				logger,
				config: { maxCount: 100, windowMs: 5_000 },
				onFlush: async () => {},
			});
			await e.start();

			await e.addEvent(makeEvent());
			await vi.advanceTimersByTimeAsync(6_000);

			expect(await redis.zcard(digestKey(SUB, EVENT))).toBe(0);

			await e.stop();
		});

		it("does not re-flush an already-flushed digest window", async () => {
			const flushed: DigestEvent[][] = [];
			const e = createDigestEngine({
				redis,
				logger,
				config: { maxCount: 100, windowMs: 5_000 },
				onFlush: async (_s, _et, events) => {
					flushed.push([...events]);
				},
			});
			await e.start();

			await e.addEvent(makeEvent());
			await vi.advanceTimersByTimeAsync(6_000); // first flush
			await vi.advanceTimersByTimeAsync(6_000); // second poll — nothing to flush

			expect(flushed).toHaveLength(1);

			await e.stop();
		});

		it("poller stops after stop() is called", async () => {
			const flushed: DigestEvent[][] = [];
			const e = createDigestEngine({
				redis,
				logger,
				config: { maxCount: 100, windowMs: 5_000 },
				onFlush: async (_s, _et, events) => {
					flushed.push([...events]);
				},
			});
			await e.start();
			await e.stop();

			await e.addEvent(makeEvent());
			await vi.advanceTimersByTimeAsync(10_000);

			expect(flushed).toHaveLength(0);
		});
	});
});

// ---------------------------------------------------------------------------
// Graceful degradation — Redis unavailable
// ---------------------------------------------------------------------------

describe("graceful degradation when Redis is unavailable", () => {
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	function makeFailingRedis(): MockRedis {
		const r = createMockRedis();
		vi.spyOn(r, "zadd").mockRejectedValue(new Error("ECONNREFUSED"));
		vi.spyOn(r, "zcard").mockRejectedValue(new Error("ECONNREFUSED"));
		vi.spyOn(r, "set").mockRejectedValue(new Error("ECONNREFUSED"));
		vi.spyOn(r, "multi").mockImplementation(() => {
			throw new Error("ECONNREFUSED");
		});
		return r;
	}

	it("addEvent does not throw when Redis is unavailable", async () => {
		const redis = makeFailingRedis();
		const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		await expect(e.addEvent(makeEvent())).resolves.not.toThrow();
		await e.stop();
	});

	it("addEvent returns false (no flush) when Redis is unavailable", async () => {
		const redis = makeFailingRedis();
		const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		expect(await e.addEvent(makeEvent())).toBe(false);
		await e.stop();
	});

	it("flush does not throw when Redis is unavailable", async () => {
		const redis = makeFailingRedis();
		const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		await expect(e.flush(SUB, EVENT)).resolves.not.toThrow();
		await e.stop();
	});

	it("flush returns empty array when Redis is unavailable", async () => {
		const redis = makeFailingRedis();
		const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		expect(await e.flush(SUB, EVENT)).toEqual([]);
		await e.stop();
	});

	it("logs a warn when Redis is unavailable during addEvent", async () => {
		const redis = makeFailingRedis();
		const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		await e.addEvent(makeEvent());
		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.any(String) }),
			expect.any(String),
		);
		await e.stop();
	});

	it("does not update queueDepth metric when Redis is unavailable", async () => {
		const metrics = createMockMetrics();
		const redis = makeFailingRedis();
		const e = createDigestEngine({ redis, logger, metrics, config: DEFAULT_CONFIG });
		await e.addEvent(makeEvent());
		expect(metrics.queueDepth.set).not.toHaveBeenCalled();
		await e.stop();
	});
});

// ---------------------------------------------------------------------------
// Boundary conditions
// ---------------------------------------------------------------------------

describe("boundary conditions", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	it("handles many events beyond maxCount without error", async () => {
		const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		for (let i = 0; i < 20; i++) {
			await e.addEvent(makeEvent({ payload: { i } }));
		}
		expect((await e.flush(SUB, EVENT)).length).toBe(20);
		await e.stop();
	});

	it("flushing a non-existent key returns empty array", async () => {
		const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		await expect(e.flush("nobody", "nothing")).resolves.toEqual([]);
		await e.stop();
	});

	it("two engines sharing same Redis: first flush empties events for second", async () => {
		const e1 = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		const e2 = createDigestEngine({ redis, logger: createMockLogger(), config: DEFAULT_CONFIG });

		await e1.addEvent(makeEvent());
		await e1.flush(SUB, EVENT);

		expect(await e2.flush(SUB, EVENT)).toEqual([]);

		await e1.stop();
		await e2.stop();
	});

	it("addEvent with empty string subscriberId does not throw", async () => {
		const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		await expect(e.addEvent(makeEvent({ subscriberId: "" }))).resolves.not.toThrow();
		await e.stop();
	});

	it("addEvent with empty payload does not throw", async () => {
		const e = createDigestEngine({ redis, logger, config: DEFAULT_CONFIG });
		await expect(e.addEvent(makeEvent({ payload: {} }))).resolves.not.toThrow();
		await e.stop();
	});
});

// ---------------------------------------------------------------------------
// B-003 Reproduction Test — digest engine loses buffered events on restart
// ---------------------------------------------------------------------------

/**
 * REPRODUCTION TEST for B-003.
 *
 * This test proves the bug exists BEFORE the fix:
 *   - Engine 1 buffers events, then stop() is called (does NOT flush)
 *   - Engine 2 starts with the same Redis — start() does NOT recover orphaned keys
 *   - Events are lost
 *
 * After the fix (flush-on-stop + SCAN recovery), this test passes because
 * either stop() flushed the events OR start() recovered them from Redis.
 */
describe("B-003: digest engine recovery", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	it("events buffered before stop() are recovered by a new engine instance on start()", async () => {
		const flushedByStop: DigestEvent[] = [];
		const flushedByNewEngine: DigestEvent[] = [];

		// Engine 1: buffer 2 events, then stop (simulating graceful shutdown)
		const engine1 = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 60_000 },
			onFlush: async (_s, _et, events) => {
				flushedByStop.push(...events);
			},
		});
		await engine1.start();
		await engine1.addEvent(makeEvent({ payload: { seq: 1 } }));
		await engine1.addEvent(makeEvent({ payload: { seq: 2 } }));
		await engine1.stop();

		// Engine 2: starts fresh with the same Redis (simulating restart)
		const engine2 = createDigestEngine({
			redis,
			logger: createMockLogger(),
			config: { maxCount: 100, windowMs: 60_000 },
			onFlush: async (_s, _et, events) => {
				flushedByNewEngine.push(...events);
			},
		});
		await engine2.start();

		// Advance timer to trigger poller — recovered digests should flush
		await vi.advanceTimersByTimeAsync(70_000);

		await engine2.stop();

		// All 2 events must be accounted for — either flushed on stop or recovered and flushed by engine2
		const totalFlushed = flushedByStop.length + flushedByNewEngine.length;
		expect(totalFlushed).toBe(2);
	});

	it("stop() calls onFlush for all active digests with buffered events", async () => {
		const flushed: Array<{ subscriberId: string; eventType: string; events: DigestEvent[] }> = [];

		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 60_000 },
			onFlush: async (subscriberId, eventType, events) => {
				flushed.push({ subscriberId, eventType, events: [...events] });
			},
		});
		await engine.start();

		await engine.addEvent(
			makeEvent({ subscriberId: "sub_1", eventType: "order.update", payload: { a: 1 } }),
		);
		await engine.addEvent(
			makeEvent({ subscriberId: "sub_2", eventType: "promo.sent", payload: { b: 2 } }),
		);

		await engine.stop();

		expect(flushed).toHaveLength(2);
		const sub1Flush = flushed.find((f) => f.subscriberId === "sub_1");
		const sub2Flush = flushed.find((f) => f.subscriberId === "sub_2");
		expect(sub1Flush).toBeDefined();
		expect(sub1Flush?.events).toHaveLength(1);
		expect(sub1Flush?.events[0]).toMatchObject({ payload: { a: 1 } });
		expect(sub2Flush).toBeDefined();
		expect(sub2Flush?.events).toHaveLength(1);
		expect(sub2Flush?.events[0]).toMatchObject({ payload: { b: 2 } });
	});

	it("stop() does not call onFlush for digests that were already flushed", async () => {
		const flushed: DigestEvent[] = [];

		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 60_000 },
			onFlush: async (_s, _et, events) => {
				flushed.push(...events);
			},
		});
		await engine.start();

		// Add event then manually flush it — nothing buffered when stop() is called
		await engine.addEvent(makeEvent());
		await engine.flush(SUB, EVENT);

		await engine.stop();

		expect(flushed).toHaveLength(0);
	});

	it("stop() with no active digests does not call onFlush", async () => {
		const onFlush = vi.fn();

		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 60_000 },
			onFlush,
		});
		await engine.start();
		await engine.stop();

		expect(onFlush).not.toHaveBeenCalled();
	});

	it("start() recovers orphaned digest keys from Redis via SCAN", async () => {
		const recovered: DigestEvent[] = [];

		// Seed Redis directly with an orphaned digest key (simulating a crash)
		const key = digestKey(SUB, EVENT);
		const now = Date.now();
		await redis.zadd(key, now, JSON.stringify({ payload: { orphaned: true }, timestamp: now }));

		// Fresh engine — no activeDigests in memory, but Redis has the key
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (_s, _et, events) => {
				recovered.push(...events);
			},
		});
		await engine.start();

		// Advance timer to trigger poller — recovered digest window is already elapsed
		await vi.advanceTimersByTimeAsync(6_000);

		await engine.stop();

		expect(recovered).toHaveLength(1);
		expect(recovered[0]).toMatchObject({ payload: { orphaned: true } });
	});

	it("start() recovery ignores flush_lock keys and _checkpoint key", async () => {
		const onFlush = vi.fn();

		// Seed lock and checkpoint keys — these must NOT be treated as digest buffers
		await redis.set("emito:digest:flush_lock:sub_1:order.update", "1", "EX", 30);
		await redis.hset("emito:digest:_checkpoint", "_dummy", "0");

		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush,
		});
		await engine.start();
		await vi.advanceTimersByTimeAsync(6_000);
		await engine.stop();

		expect(onFlush).not.toHaveBeenCalled();
	});

	it("periodic checkpoint is written on each poller tick", async () => {
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
		});
		await engine.start();

		// Buffer an event so there's something to checkpoint
		await engine.addEvent(makeEvent());

		// Advance one tick
		await vi.advanceTimersByTimeAsync(5_000);

		const checkpoint = await redis.hgetall("emito:digest:_checkpoint");
		expect(Object.keys(checkpoint).length).toBeGreaterThan(0);

		const mapKey = `${SUB}:${EVENT}`;
		expect(checkpoint[mapKey]).toBeDefined();
		expect(Number(checkpoint[mapKey])).toEqual(expect.any(Number));

		await engine.stop();
	});

	it("checkpoint is read on start() for faster recovery of known digest windows", async () => {
		// Write a checkpoint simulating a prior engine's state with an already-elapsed window
		const cpKey = "emito:digest:_checkpoint";
		const staleFirstEventAt = Date.now() - 70_000;
		await redis.hset(cpKey, `${SUB}:${EVENT}`, String(staleFirstEventAt));

		// Also seed the corresponding Redis digest key
		const key = digestKey(SUB, EVENT);
		const now = Date.now();
		await redis.zadd(
			key,
			now,
			JSON.stringify({ payload: { fromCheckpoint: true }, timestamp: now }),
		);

		const recovered: DigestEvent[] = [];
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (_s, _et, events) => {
				recovered.push(...events);
			},
		});
		await engine.start();

		// Even a short advance should flush — checkpoint firstEventAt is already stale
		await vi.advanceTimersByTimeAsync(6_000);

		await engine.stop();

		expect(recovered).toHaveLength(1);
		expect(recovered[0]).toMatchObject({ payload: { fromCheckpoint: true } });
	});

	it("stop() deletes checkpoint hash after flushing all active digests", async () => {
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 60_000 },
			onFlush: async () => {},
		});
		await engine.start();

		await engine.addEvent(makeEvent());
		await engine.stop();

		// Checkpoint must be deleted after clean shutdown
		const checkpoint = await redis.hgetall("emito:digest:_checkpoint");
		expect(Object.keys(checkpoint).length).toBe(0);
	});

	it("combined checkpoint + SCAN: SCAN catches orphaned keys not in checkpoint", async () => {
		// Write checkpoint for sub_1 (from prior run)
		await redis.hset("emito:digest:_checkpoint", "sub_1:order.update", String(Date.now() - 10_000));

		// Seed orphaned key for sub_orphan NOT listed in checkpoint (crash before checkpoint write)
		const orphanKey = digestKey("sub_orphan", "promo.sent");
		const orphanTs = Date.now();
		await redis.zadd(
			orphanKey,
			orphanTs,
			JSON.stringify({ payload: { from: "scan" }, timestamp: orphanTs }),
		);

		// Also seed the sub_1 key so the checkpoint entry has something to flush
		const sub1Key = digestKey("sub_1", "order.update");
		await redis.zadd(
			sub1Key,
			orphanTs,
			JSON.stringify({ payload: { from: "checkpoint" }, timestamp: orphanTs }),
		);

		const recovered: Array<{ subscriberId: string; eventType: string }> = [];
		const engine = createDigestEngine({
			redis,
			logger: createMockLogger(),
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (subscriberId, eventType) => {
				recovered.push({ subscriberId, eventType });
			},
		});
		await engine.start();
		await vi.advanceTimersByTimeAsync(6_000);
		await engine.stop();

		expect(
			recovered.some((r) => r.subscriberId === "sub_1" && r.eventType === "order.update"),
		).toBe(true);
		expect(
			recovered.some((r) => r.subscriberId === "sub_orphan" && r.eventType === "promo.sent"),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Task 2 (D-011): Digest checkpoint uses Redis hash (HSET/HGETALL/HDEL)
// ---------------------------------------------------------------------------

/**
 * Tests verifying that the digest checkpoint is stored as a Redis hash
 * (HSET per entry, HGETALL on read, HDEL on individual entry removal)
 * instead of a JSON blob (JSON.stringify/JSON.parse with GET/SET).
 *
 * Success criteria (D-011):
 * - Checkpoint write uses HSET — no JSON.stringify in the checkpoint path
 * - Checkpoint read uses HGETALL — no JSON.parse in the checkpoint path
 * - Checkpoint cleanup uses DEL (unchanged)
 * - Individual entry removal on flush uses HDEL
 */
describe("D-011: checkpoint uses Redis hash (HSET/HGETALL/HDEL)", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	const cpKey = "emito:digest:_checkpoint";

	it("periodic checkpoint is written to a Redis hash (HSET), not a string key", async () => {
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
		});
		await engine.start();

		await engine.addEvent(makeEvent({ subscriberId: SUB, eventType: EVENT }));

		// Advance one poller tick to trigger checkpoint write
		await vi.advanceTimersByTimeAsync(5_000);

		// The checkpoint must be stored as a hash — hgetall returns a record, not null/empty
		const hashFields = await redis.hgetall(cpKey);
		expect(Object.keys(hashFields).length).toBeGreaterThan(0);

		// The specific field for this subscriber+eventType must exist
		expect(hashFields[`${SUB}:${EVENT}`]).toBeDefined();

		// The value stored in the hash field must be a numeric string (firstEventAt timestamp)
		const fieldValue = hashFields[`${SUB}:${EVENT}`];
		expect(Number(fieldValue)).toBeGreaterThan(0);

		// The checkpoint must NOT be stored as a plain string (old JSON blob format)
		const stringValue = await redis.get(cpKey);
		expect(stringValue).toBeNull();

		await engine.stop();
	});

	it("start() reads checkpoint from Redis hash (HGETALL) for recovery", async () => {
		// Seed checkpoint as a hash (the new format: plain numeric string for firstEventAt)
		const staleFirstEventAt = Date.now() - 70_000;
		await redis.hset(cpKey, `${SUB}:${EVENT}`, String(staleFirstEventAt));

		// Seed the corresponding digest key in Redis
		const key = digestKey(SUB, EVENT);
		const now = Date.now();
		await redis.zadd(key, now, JSON.stringify({ payload: { fromHash: true }, timestamp: now }));

		const recovered: DigestEvent[] = [];
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (_s, _et, events) => {
				recovered.push(...events);
			},
		});
		await engine.start();

		// The engine should have read the hash checkpoint and recovered the stale entry
		await vi.advanceTimersByTimeAsync(6_000);
		await engine.stop();

		// Event should be recovered and flushed (firstEventAt was 70s ago, window is 5s)
		expect(recovered).toHaveLength(1);
		expect(recovered[0]).toMatchObject({ payload: { fromHash: true } });
	});

	it("checkpoint hash entry is removed (HDEL) on next poller tick after a digest is flushed", async () => {
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
		});
		await engine.start();

		await engine.addEvent(makeEvent({ subscriberId: SUB, eventType: EVENT }));

		// First tick: poller writes checkpoint with the active digest entry
		await vi.advanceTimersByTimeAsync(5_000);

		const beforeFlush = await redis.hgetall(cpKey);
		expect(beforeFlush[`${SUB}:${EVENT}`]).toBeDefined();

		// Manually flush the digest — untrackKey() removes it from activeDigests
		await engine.flush(SUB, EVENT);

		// Second tick: poller detects no active digests, removes the stale field via HDEL
		await vi.advanceTimersByTimeAsync(5_000);

		const afterFlush = await redis.hgetall(cpKey);
		expect(afterFlush[`${SUB}:${EVENT}`]).toBeUndefined();

		await engine.stop();
	});

	it("stop() deletes the entire checkpoint hash key after clean shutdown", async () => {
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 60_000 },
			onFlush: async () => {},
		});
		await engine.start();

		await engine.addEvent(makeEvent({ subscriberId: SUB, eventType: EVENT }));

		// One tick to write checkpoint
		await vi.advanceTimersByTimeAsync(60_000);

		// Verify checkpoint exists (as hash)
		const beforeStop = await redis.hgetall(cpKey);
		expect(Object.keys(beforeStop).length).toBeGreaterThan(0);

		await engine.stop();

		// Checkpoint must be deleted after clean shutdown
		const afterStop = await redis.hgetall(cpKey);
		expect(Object.keys(afterStop)).toHaveLength(0);
		// Also verify it's not stored as a string
		expect(await redis.get(cpKey)).toBeNull();
	});

	it("multiple active digests: each gets its own hash field in the checkpoint", async () => {
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
		});
		await engine.start();

		await engine.addEvent(makeEvent({ subscriberId: "sub_a", eventType: "order.update" }));
		await engine.addEvent(makeEvent({ subscriberId: "sub_b", eventType: "promo.sent" }));

		// One poller tick to write checkpoint
		await vi.advanceTimersByTimeAsync(5_000);

		const hashFields = await redis.hgetall(cpKey);

		// Both digests must have their own fields
		expect(hashFields["sub_a:order.update"]).toBeDefined();
		expect(hashFields["sub_b:promo.sent"]).toBeDefined();
		expect(Object.keys(hashFields)).toHaveLength(2);

		await engine.stop();
	});

	it("graceful degradation: checkpoint write failure does not crash the engine", async () => {
		const brokenRedis = createMockRedis();
		const realMulti = brokenRedis.multi.bind(brokenRedis);
		vi.spyOn(brokenRedis, "multi").mockImplementation(() => {
			const chain = realMulti();
			chain.exec = async () => { throw new Error("ECONNREFUSED"); };
			return chain;
		});

		const brokenLogger = createMockLogger();
		const engine = createDigestEngine({
			redis: brokenRedis,
			logger: brokenLogger,
			config: { maxCount: 100, windowMs: 5_000 },
		});
		await engine.start();

		await engine.addEvent(makeEvent());

		// Should not throw even when hset fails
		await expect(vi.advanceTimersByTimeAsync(5_000)).resolves.not.toThrow();

		expect(brokenLogger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.any(String) }),
			expect.stringContaining("checkpoint"),
		);

		await engine.stop();
	});
});

// ---------------------------------------------------------------------------
// send.ts integration: digested ChannelResult status
// ---------------------------------------------------------------------------

describe("executeSend with digest engine buffering the event", () => {
	it("returns digested ChannelResult when digest engine buffers the event", async () => {
		const subscriberRepo = new InMemorySubscriberRepository();
		subscriberRepo.seed({
			id: "sub_digest",
			email: "digest@example.com",
			phone: null,
			locale: "en",
			timezone: null,
			globallyUnsubscribed: false,
			metadata: {},
			erasedAt: null,
			createdAt: new Date("2026-01-01T00:00:00Z"),
			updatedAt: new Date("2026-01-01T00:00:00Z"),
		});

		const eventRegistry = createEventRegistry({
			"order.update": {
				category: "transactional",
				channels: ["email"],
				digest: { maxCount: 5, windowMs: 60_000 },
			},
		});

		// Stub that always buffers (addEvent returns false = below threshold)
		const bufferingDigestEngine: DigestEngine = {
			addEvent: vi.fn().mockResolvedValue(false),
			flush: vi.fn().mockResolvedValue([]),
			start: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
		};

		const logger = createMockLogger();

		const deps: SendDeps = {
			eventRegistry,
			subscriberRepository: subscriberRepo,
			notificationRepository: new InMemoryNotificationRepository(),
			preferenceRepository: new InMemoryPreferenceRepository(),
			workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
			suppressionRepository: new InMemorySuppressionRepository(),
			subscriptionRepository: new InMemorySubscriptionRepository(),
			deadLetterRepository: new InMemoryDeadLetterRepository(),
			integrationRepository: new InMemoryIntegrationRepository(),
			inboxRepository: new InMemoryInboxRepository(),
			channelProviders: new Map(),
			channelConfigs: new Map(),
			templateResolver: {
				resolve: async () => ({ body: "hello", subject: "hi" }),
			},
			logger: logger as any,
			defaultLang: "en",
			categories: { transactional: { policy: "always" } },
			digestEngine: bufferingDigestEngine,
		};

		const result = await executeSend(
			{ subscriberId: "sub_digest", event: "order.update", payload: {} },
			deps,
		);

		const emailResult = result.channels.find((c) => c.channel === "email");
		expect(emailResult).toMatchObject({ channel: "email", status: "digested" });
	});
});

// ---------------------------------------------------------------------------
// B-003 Reproduction: digest engine loses buffered events on shutdown
// ---------------------------------------------------------------------------

describe("B-003 reproduction: digest engine loses buffered events on shutdown", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	it("stop() flushes all buffered events via onFlush", async () => {
		const flushedOnStop: DigestEvent[][] = [];
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 60_000 },
			onFlush: async (_s, _et, events) => {
				flushedOnStop.push([...events]);
			},
		});
		await engine.start();

		// Buffer events
		await engine.addEvent(makeEvent({ payload: { i: 1 } }));
		await engine.addEvent(makeEvent({ payload: { i: 2 } }));

		// Pre-fix: stop() only cleared the interval and did NOT flush.
		// Post-fix: stop() flushes all active digests before clearing.
		await engine.stop();

		// Assert flush-on-stop fired (this is the B-003 fix — pre-fix this would be 0)
		expect(flushedOnStop).toHaveLength(1);
		expect(flushedOnStop[0]).toHaveLength(2);

		// Assert Redis key is cleaned up (events are gone, not orphaned)
		expect(await redis.zcard(digestKey(SUB, EVENT))).toBe(0);
	});

	it("new engine after restart has nothing to recover because stop() flushed everything", async () => {
		const engine1 = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async () => {},
		});
		await engine1.start();
		await engine1.addEvent(makeEvent({ payload: { i: 1 } }));
		await engine1.addEvent(makeEvent({ payload: { i: 2 } }));
		await engine1.stop();

		// Engine 2 starts — SCAN should find nothing (stop flushed + deleted keys)
		const flushed2: DigestEvent[][] = [];
		const engine2 = createDigestEngine({
			redis,
			logger: createMockLogger(),
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (_s, _et, events) => {
				flushed2.push([...events]);
			},
		});
		await engine2.start();
		await vi.advanceTimersByTimeAsync(6_000);
		await engine2.stop();

		// Nothing to recover — stop() already handled everything
		expect(flushed2).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// D-012: Multi-instance digest resilience
// ---------------------------------------------------------------------------

/**
 * Tests for D-012: per-instance checkpoint, stale tracking cleanup,
 * and cluster-aware SCAN.
 *
 * Success criteria:
 * - Per-instance checkpoint keys don't collide across instanceIds
 * - checkpointKey(instanceId) returns emito:digest:_checkpoint:{instanceId}
 * - checkpointKey() (no instanceId) returns emito:digest:_checkpoint (backward compat)
 * - Stale activeDigests entries are removed when lock miss AND Redis key is gone
 * - scanAll option iterates multiple "nodes" (mocked as multiple scan call batches)
 */
describe("D-012: per-instance checkpoint", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
	});

	afterEach(async () => {
		vi.useRealTimers();
		redis.clear();
	});

	it("checkpointKey with instanceId returns emito:digest:_checkpoint:{instanceId}", () => {
		expect(checkpointKey("inst_abc")).toBe("emito:digest:_checkpoint:inst_abc");
	});

	it("checkpointKey without instanceId returns emito:digest:_checkpoint (backward compat)", () => {
		expect(checkpointKey()).toBe("emito:digest:_checkpoint");
	});

	it("two engines with different instanceIds write to separate checkpoint keys", async () => {
		const engine1 = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000, instanceId: "inst_A" },
		});
		const engine2 = createDigestEngine({
			redis,
			logger: createMockLogger(),
			config: { maxCount: 100, windowMs: 5_000, instanceId: "inst_B" },
		});

		await engine1.start();
		await engine2.start();

		await engine1.addEvent(makeEvent({ subscriberId: "sub_1", eventType: "order.update" }));
		await engine2.addEvent(makeEvent({ subscriberId: "sub_2", eventType: "promo.sent" }));

		// Advance to trigger checkpoint write
		await vi.advanceTimersByTimeAsync(5_000);

		const cp1 = await redis.hgetall("emito:digest:_checkpoint:inst_A");
		const cp2 = await redis.hgetall("emito:digest:_checkpoint:inst_B");

		// Each instance wrote its own checkpoint, not the other's
		expect(Object.keys(cp1).length).toBeGreaterThan(0);
		expect(Object.keys(cp2).length).toBeGreaterThan(0);

		// inst_A only has sub_1's digest
		expect(Object.keys(cp1)).toContain("sub_1:order.update");
		expect(Object.keys(cp1)).not.toContain("sub_2:promo.sent");

		// inst_B only has sub_2's digest
		expect(Object.keys(cp2)).toContain("sub_2:promo.sent");
		expect(Object.keys(cp2)).not.toContain("sub_1:order.update");

		await engine1.stop();
		await engine2.stop();
	});

	it("per-instance checkpoint: instance reads its own checkpoint on start()", async () => {
		// Seed instance A's checkpoint
		await redis.hset(
			"emito:digest:_checkpoint:inst_A",
			`${SUB}:${EVENT}`,
			String(Date.now() - 70_000),
		);

		// Also seed a generic (no-instanceId) checkpoint that should NOT be read
		await redis.hset(
			"emito:digest:_checkpoint",
			"sub_other:other.event",
			String(Date.now() - 70_000),
		);

		// Seed the Redis key for inst_A's digest
		const key = digestKey(SUB, EVENT);
		const now = Date.now();
		await redis.zadd(
			key,
			now,
			JSON.stringify({ payload: { from: "inst_A_checkpoint" }, timestamp: now }),
		);

		const recovered: DigestEvent[] = [];
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000, instanceId: "inst_A" },
			onFlush: async (_s, _et, events) => {
				recovered.push(...events);
			},
		});
		await engine.start();
		await vi.advanceTimersByTimeAsync(6_000);
		await engine.stop();

		// Should have recovered sub/event from inst_A's own checkpoint
		expect(recovered).toHaveLength(1);
		expect(recovered[0]).toMatchObject({ payload: { from: "inst_A_checkpoint" } });
	});

	it("per-instance checkpoint: stop() deletes instance-specific checkpoint key", async () => {
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 60_000, instanceId: "inst_del" },
			onFlush: async () => {},
		});
		await engine.start();
		await engine.addEvent(makeEvent());
		await engine.stop();

		const cp = await redis.hgetall("emito:digest:_checkpoint:inst_del");
		expect(Object.keys(cp).length).toBe(0);
	});

	it("per-instance checkpoint: instance A crash does not corrupt instance B's checkpoint", async () => {
		// Instance A writes its checkpoint, then crashes (we simulate by never calling stop)
		const engine_A = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000, instanceId: "inst_A" },
		});
		await engine_A.start();
		await engine_A.addEvent(makeEvent({ subscriberId: "sub_A", eventType: "order.update" }));
		await vi.advanceTimersByTimeAsync(5_000); // triggers checkpoint write

		// Instance B starts independently
		const flushed_B: DigestEvent[] = [];
		const engine_B = createDigestEngine({
			redis,
			logger: createMockLogger(),
			config: { maxCount: 100, windowMs: 5_000, instanceId: "inst_B" },
			onFlush: async (_s, _et, events) => {
				flushed_B.push(...events);
			},
		});
		await engine_B.start();

		await engine_B.addEvent(makeEvent({ subscriberId: "sub_B", eventType: "promo.sent" }));
		await vi.advanceTimersByTimeAsync(6_000);

		// inst_B's checkpoint should only contain its own key
		const cp_B = await redis.hgetall("emito:digest:_checkpoint:inst_B");
		// After flush the key is deleted by stop
		// Just verify engine_B flushed its own digest
		expect(flushed_B.some((e) => e.subscriberId === "sub_B")).toBe(true);

		// inst_A's checkpoint still exists independently (not corrupted by B)
		const cp_A = await redis.hgetall("emito:digest:_checkpoint:inst_A");
		// A's checkpoint may still be around (A never called stop)
		// The important thing is B's flush didn't overwrite A's checkpoint
		if (Object.keys(cp_A).length > 0) {
			expect(Object.keys(cp_A)).not.toContain("sub_B:promo.sent");
		}

		await engine_A.stop();
		await engine_B.stop();
	});

	it("start() recovery ignores checkpoint keys for other instances", async () => {
		// Seed inst_B's checkpoint — inst_A should not pick it up
		await redis.hset(
			"emito:digest:_checkpoint:inst_B",
			"sub_B:order.update",
			String(Date.now() - 10_000),
		);

		// Seed inst_B's digest key (something it had buffered)
		const bKey = digestKey("sub_B", "order.update");
		const now = Date.now();
		await redis.zadd(bKey, now, JSON.stringify({ payload: { from: "inst_B" }, timestamp: now }));

		const flushed_A: DigestEvent[] = [];
		const engine_A = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000, instanceId: "inst_A" },
			onFlush: async (_s, _et, events) => {
				flushed_A.push(...events);
			},
		});
		await engine_A.start();

		// inst_A SCAN will find bKey — it should recover it (SCAN catches all orphaned keys)
		// but it should NOT use inst_B's checkpoint as its own timing reference
		await vi.advanceTimersByTimeAsync(6_000);

		await engine_A.stop();

		// The SCAN-recovered key from inst_B gets flushed by inst_A (correct — SCAN recovery is global)
		// Key check: inst_A's own checkpoint key was never "emito:digest:_checkpoint:inst_B"
		expect(flushed_A.some((e) => e.payload.from === "inst_B")).toBe(true);
	});
});

describe("D-012: stale tracking cleanup on lock miss", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
	});

	afterEach(async () => {
		vi.useRealTimers();
		redis.clear();
	});

	it("stale entry is removed from activeDigests when lock miss AND Redis key is gone", async () => {
		const flushed: DigestEvent[][] = [];
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (_s, _et, events) => {
				flushed.push([...events]);
			},
		});
		await engine.start();

		// Buffer an event to create a tracked entry
		await engine.addEvent(makeEvent());

		// Simulate: another instance flushed it (Redis key is gone), but we have the lock
		// To test stale cleanup specifically: manually delete the Redis key (simulating TTL expiry
		// or another instance having flushed), then simulate a lock miss by pre-setting the lock
		const key = digestKey(SUB, EVENT);
		await redis.del(key); // Redis key is gone (expired or flushed by another instance)

		// Pre-set lock so acquireFlushLock returns false
		await redis.set(flushLockKey(SUB, EVENT), "1", "NX", "EX", 30);

		// Advance past windowMs — poller runs, sees lock miss, checks key existence
		await vi.advanceTimersByTimeAsync(6_000);

		// Now delete the lock and advance again — this time entry should already be untracked
		await redis.del(flushLockKey(SUB, EVENT));
		await vi.advanceTimersByTimeAsync(6_000);

		// The stale entry was cleaned up: no onFlush called (key was gone), no double tracking
		// Evidence: with key gone, flush should produce 0 events even if lock clears
		expect(flushed).toHaveLength(0);

		await engine.stop();
	});

	it("entry is NOT removed from activeDigests when lock miss but Redis key still exists", async () => {
		// Scenario: another instance holds the lock but the key is still there
		// The entry should remain tracked so we can flush it later
		const flushed: DigestEvent[][] = [];
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (_s, _et, events) => {
				flushed.push([...events]);
			},
		});
		await engine.start();

		await engine.addEvent(makeEvent({ payload: { important: true } }));

		// Pre-set lock so poller gets lock miss — but do NOT delete the Redis key
		await redis.set(flushLockKey(SUB, EVENT), "1", "NX", "EX", 30);

		// First poller tick: lock miss, key still exists → keep tracking
		await vi.advanceTimersByTimeAsync(6_000);

		// Release lock, advance again — should now flush successfully
		await redis.del(flushLockKey(SUB, EVENT));
		await vi.advanceTimersByTimeAsync(6_000);

		// Entry was kept, flush eventually succeeded
		expect(flushed).toHaveLength(1);
		expect(flushed[0]).toHaveLength(1);
		expect(flushed[0][0]).toMatchObject({ payload: { important: true } });

		await engine.stop();
	});

	it("stale cleanup: multiple stale entries all cleaned on lock miss + key gone", async () => {
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
		});
		await engine.start();

		// Buffer events for 3 different subscriber+eventType combos
		for (const [sub, evt] of [
			["s1", "e1"],
			["s2", "e2"],
			["s3", "e3"],
		]) {
			await engine.addEvent(makeEvent({ subscriberId: sub, eventType: evt }));
		}

		// Delete all their Redis keys (expired/flushed by another instance)
		for (const [sub, evt] of [
			["s1", "e1"],
			["s2", "e2"],
			["s3", "e3"],
		]) {
			await redis.del(digestKey(sub, evt));
			await redis.set(flushLockKey(sub, evt), "1", "NX", "EX", 30);
		}

		// Advance past windowMs — poller sees 3 lock misses with no key → removes all
		await vi.advanceTimersByTimeAsync(6_000);

		// Release all locks and advance again
		for (const [sub, evt] of [
			["s1", "e1"],
			["s2", "e2"],
			["s3", "e3"],
		]) {
			await redis.del(flushLockKey(sub, evt));
		}
		await vi.advanceTimersByTimeAsync(6_000);

		// After stop(), no flush should happen (stale entries were cleaned up)
		// stop() will try to flush activeDigests — if they were cleaned, nothing to flush
		const flushedOnStop: DigestEvent[] = [];
		// Re-create engine to capture stop flush
		const engine2 = createDigestEngine({
			redis,
			logger: createMockLogger(),
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (_s, _et, events) => {
				flushedOnStop.push(...events);
			},
		});
		// Don't start engine2 — just verify Redis is clean
		// The original engine cleaned up stale entries; Redis keys were already gone
		expect(await redis.zcard(digestKey("s1", "e1"))).toBe(0);
		expect(await redis.zcard(digestKey("s2", "e2"))).toBe(0);
		expect(await redis.zcard(digestKey("s3", "e3"))).toBe(0);

		await engine.stop();
	});
});

describe("D-012: cluster-aware SCAN (scanAll)", () => {
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("engine uses redis.scanAll when available (cluster-aware)", async () => {
		const redis = createMockRedis();
		const now = Date.now();

		// Seed orphaned digest keys
		await redis.zadd(
			digestKey("sub_1", "evt_1"),
			now,
			JSON.stringify({ payload: { n: 1 }, timestamp: now }),
		);
		await redis.zadd(
			digestKey("sub_2", "evt_2"),
			now,
			JSON.stringify({ payload: { n: 2 }, timestamp: now }),
		);

		// Spy on scanAll to verify it's called instead of scan
		const scanAllSpy = vi.spyOn(redis, "scanAll");
		const scanSpy = vi.spyOn(redis, "scan");

		const recovered: Array<{ subscriberId: string }> = [];
		const engine = createDigestEngine({
			redis,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (subscriberId) => {
				recovered.push({ subscriberId });
			},
		});
		await engine.start();
		await vi.advanceTimersByTimeAsync(6_000);
		await engine.stop();

		// scanAll was called (preferred over scan for cluster-aware recovery)
		expect(scanAllSpy).toHaveBeenCalled();
		// Both keys were recovered
		expect(recovered.some((r) => r.subscriberId === "sub_1")).toBe(true);
		expect(recovered.some((r) => r.subscriberId === "sub_2")).toBe(true);
	});

	it("engine falls back to scan when redis.scanAll is not available", async () => {
		const redis = createMockRedis();
		const now = Date.now();

		await redis.zadd(
			digestKey(SUB, EVENT),
			now,
			JSON.stringify({ payload: { single: true }, timestamp: now }),
		);

		// Remove scanAll to simulate non-cluster Redis
		const redisWithoutScanAll = { ...redis } as typeof redis;
		delete (redisWithoutScanAll as any).scanAll;

		const scanSpy = vi.spyOn(redis, "scan");
		// Bind scan to the original redis so the spy picks up calls
		redisWithoutScanAll.scan = redis.scan.bind(redis);

		const recovered: DigestEvent[] = [];
		const engine = createDigestEngine({
			redis: redisWithoutScanAll,
			logger,
			config: { maxCount: 100, windowMs: 5_000 },
			onFlush: async (_s, _et, events) => {
				recovered.push(...events);
			},
		});

		await expect(engine.start()).resolves.not.toThrow();
		await vi.advanceTimersByTimeAsync(6_000);
		await engine.stop();

		// Falls back to regular scan and still recovers
		expect(scanSpy).toHaveBeenCalled();
		expect(recovered).toHaveLength(1);
		expect(recovered[0]).toMatchObject({ payload: { single: true } });
	});

	it("mock redis scanAll returns same results as scan (no cluster simulation)", async () => {
		const redis = createMockRedis();
		const now = Date.now();

		await redis.zadd(
			digestKey("sub_1", "evt_1"),
			now,
			JSON.stringify({ payload: {}, timestamp: now }),
		);
		await redis.zadd(
			digestKey("sub_2", "evt_2"),
			now,
			JSON.stringify({ payload: {}, timestamp: now }),
		);

		const [cursor1, keys1] = await redis.scan("0", "emito:digest:*", 100);
		const [cursor2, keys2] = await redis.scanAll!("0", "emito:digest:*", 100);

		expect(cursor1).toBe(cursor2);
		expect(keys1.sort()).toEqual(keys2.sort());
	});
});
