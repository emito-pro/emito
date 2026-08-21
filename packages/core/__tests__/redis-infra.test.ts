import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type HealthCheckResult, healthCheck, start, stop } from "../src/lifecycle";
import type { RedisLike } from "../src/redis/types";
import { type MockRedis, createMockRedis } from "./helpers/mock-redis";

// --- Mock Redis contract tests ---

describe("MockRedis", () => {
	let redis: MockRedis;

	beforeEach(() => {
		redis = createMockRedis();
	});

	afterEach(() => {
		redis.clear();
	});

	describe("sorted sets", () => {
		it("zadd adds members and returns 1 for new, 0 for existing", async () => {
			expect(await redis.zadd("zset", 1, "a")).toBe(1);
			expect(await redis.zadd("zset", 2, "b")).toBe(1);
			expect(await redis.zadd("zset", 3, "a")).toBe(0); // update
		});

		it("zcard returns the count of members", async () => {
			expect(await redis.zcard("zset")).toBe(0);
			await redis.zadd("zset", 1, "a");
			await redis.zadd("zset", 2, "b");
			expect(await redis.zcard("zset")).toBe(2);
		});

		it("zrangebyscore returns members within score range", async () => {
			await redis.zadd("zset", 1, "a");
			await redis.zadd("zset", 5, "b");
			await redis.zadd("zset", 10, "c");

			expect(await redis.zrangebyscore("zset", 1, 5)).toEqual(["a", "b"]);
			expect(await redis.zrangebyscore("zset", 6, 10)).toEqual(["c"]);
			expect(await redis.zrangebyscore("zset", "-inf", "+inf")).toEqual(["a", "b", "c"]);
		});

		it("zremrangebyscore removes members and returns count", async () => {
			await redis.zadd("zset", 1, "a");
			await redis.zadd("zset", 5, "b");
			await redis.zadd("zset", 10, "c");

			expect(await redis.zremrangebyscore("zset", 0, 5)).toBe(2);
			expect(await redis.zcard("zset")).toBe(1);
		});

		it("zrem removes specific members", async () => {
			await redis.zadd("zset", 1, "a");
			await redis.zadd("zset", 2, "b");
			await redis.zadd("zset", 3, "c");

			expect(await redis.zrem("zset", "a", "c")).toBe(2);
			expect(await redis.zcard("zset")).toBe(1);
		});

		it("zrem returns 0 for non-existent key", async () => {
			expect(await redis.zrem("nonexistent", "a")).toBe(0);
		});
	});

	describe("strings", () => {
		it("set and get store and retrieve values", async () => {
			await redis.set("key", "value");
			expect(await redis.get("key")).toBe("value");
		});

		it("get returns null for missing keys", async () => {
			expect(await redis.get("missing")).toBeNull();
		});

		it("set with NX only sets if key does not exist", async () => {
			const first = await redis.set("lock", "1", "NX", "EX", 30);
			expect(first).toBe("OK");

			const second = await redis.set("lock", "2", "NX", "EX", 30);
			expect(second).toBeNull();

			expect(await redis.get("lock")).toBe("1");
		});

		it("set with EX sets TTL", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

			await redis.set("ttl-key", "val", "EX", 10);
			expect(await redis.get("ttl-key")).toBe("val");

			vi.advanceTimersByTime(11_000);
			expect(await redis.get("ttl-key")).toBeNull();

			vi.useRealTimers();
		});
	});

	describe("key operations", () => {
		it("del removes keys and returns 1 if existed", async () => {
			await redis.set("key", "value");
			expect(await redis.del("key")).toBe(1);
			expect(await redis.get("key")).toBeNull();
		});

		it("del returns 0 for non-existent keys", async () => {
			expect(await redis.del("missing")).toBe(0);
		});

		it("exists returns 1 for existing keys, 0 for missing", async () => {
			await redis.set("key", "value");
			expect(await redis.exists("key")).toBe(1);
			expect(await redis.exists("missing")).toBe(0);
		});

		it("expire sets TTL on existing key", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

			await redis.zadd("zset", 1, "a");
			expect(await redis.expire("zset", 5)).toBe(1);

			vi.advanceTimersByTime(6_000);
			expect(await redis.zcard("zset")).toBe(0);

			vi.useRealTimers();
		});

		it("expire returns 0 for non-existent key", async () => {
			expect(await redis.expire("missing", 5)).toBe(0);
		});
	});

	describe("multi/exec", () => {
		it("executes chained operations atomically", async () => {
			await redis.zadd("zset", 100, "old");

			const results = await redis
				.multi()
				.zremrangebyscore("zset", 0, 50)
				.zadd("zset", 200, "new")
				.zcard("zset")
				.expire("zset", 3600)
				.exec();

			expect(results).toHaveLength(4);
			// Each result is [null, value]
			expect(results[0]).toEqual([null, 0]); // zremrangebyscore removed 0 (100 > 50)
			expect(results[1]).toEqual([null, 1]); // zadd added 1
			expect(results[2]).toEqual([null, 2]); // zcard = 2 (old + new)
			expect(results[3]).toEqual([null, 1]); // expire succeeded
		});

		it("supports zrangebyscore in multi", async () => {
			await redis.zadd("zset", 1, "a");
			await redis.zadd("zset", 2, "b");
			await redis.zadd("zset", 3, "c");

			const results = await redis.multi().zrangebyscore("zset", 1, 2).del("zset").exec();

			expect(results[0]).toEqual([null, ["a", "b"]]);
			expect(results[1]).toEqual([null, 1]);
		});

		it("supports zrem in multi", async () => {
			await redis.zadd("zset", 1, "a");
			await redis.zadd("zset", 2, "b");

			const results = await redis.multi().zrem("zset", "a").exec();
			expect(results[0]).toEqual([null, 1]);
			expect(await redis.zcard("zset")).toBe(1);
		});
	});

	describe("ping and quit", () => {
		it("ping returns PONG", async () => {
			expect(await redis.ping()).toBe("PONG");
		});

		it("quit returns OK", async () => {
			expect(await redis.quit()).toBe("OK");
		});
	});

	describe("clear", () => {
		it("removes all stored data", async () => {
			await redis.zadd("zset", 1, "a");
			await redis.set("key", "value");
			redis.clear();
			expect(await redis.zcard("zset")).toBe(0);
			expect(await redis.get("key")).toBeNull();
		});
	});
});

// --- Lifecycle Redis integration tests ---

describe("lifecycle with Redis", () => {
	const mockLogger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
		level: "silent",
	};

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("start", () => {
		it("pings Redis on start", async () => {
			const redis = createMockRedis();
			const pingSpy = vi.spyOn(redis, "ping");

			await start({ providers: [], logger: mockLogger as any, redis });

			expect(pingSpy).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith("redis connected");
		});

		it("warns but does not throw when Redis ping fails", async () => {
			const redis = createMockRedis();
			vi.spyOn(redis, "ping").mockRejectedValue(new Error("ECONNREFUSED"));

			await start({ providers: [], logger: mockLogger as any, redis });

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ error: expect.stringContaining("ECONNREFUSED") }),
				"redis ping failed at startup",
			);
		});

		it("works without Redis configured", async () => {
			await start({ providers: [], logger: mockLogger as any });
			expect(mockLogger.info).toHaveBeenCalledWith("emito started");
		});
	});

	describe("stop", () => {
		it("quits Redis on stop", async () => {
			const redis = createMockRedis();
			const quitSpy = vi.spyOn(redis, "quit");

			await stop({ providers: [], logger: mockLogger as any, redis });

			expect(quitSpy).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith("redis disconnected");
		});

		it("warns but does not throw when Redis quit fails", async () => {
			const redis = createMockRedis();
			vi.spyOn(redis, "quit").mockRejectedValue(new Error("already closed"));

			await stop({ providers: [], logger: mockLogger as any, redis });

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ error: expect.stringContaining("already closed") }),
				"redis quit failed during shutdown",
			);
		});
	});

	describe("healthCheck", () => {
		it("includes Redis health when configured", async () => {
			const redis = createMockRedis();
			const result = await healthCheck({
				providers: [],
				logger: mockLogger as any,
				redis,
			});

			expect(result.redis).toEqual({ healthy: true });
			expect(result.healthy).toBe(true);
		});

		it("reports unhealthy when Redis ping fails", async () => {
			const redis = createMockRedis();
			vi.spyOn(redis, "ping").mockRejectedValue(new Error("timeout"));

			const result = await healthCheck({
				providers: [],
				logger: mockLogger as any,
				redis,
			});

			expect(result.redis).toEqual({ healthy: false });
			expect(result.healthy).toBe(false);
		});

		it("omits Redis from result when not configured", async () => {
			const result = await healthCheck({
				providers: [],
				logger: mockLogger as any,
			});

			expect(result.redis).toBeUndefined();
			expect(result.healthy).toBe(true);
		});
	});
});
