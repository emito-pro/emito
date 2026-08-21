/**
 * Unit tests for the ioredis adapter implementing RedisLike.
 *
 * Strategy: mock the ioredis instance and verify the adapter maps each
 * RedisLike method to the correct ioredis call with the correct arguments.
 * We do NOT test that ioredis itself behaves correctly (rule 30).
 *
 * Rules applied:
 * - Never mock the module under test (rule 10) — we mock ioredis, not the adapter
 * - Assert on call arguments for mock verifications (rule 28)
 * - Prefer specific matchers (rule 25)
 * - Reset all mocks in afterEach (rule 14)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisLike } from "../src/redis/types";

// ---------------------------------------------------------------------------
// Shared ioredis mock factory
// ---------------------------------------------------------------------------

function createMockIoRedis() {
	return {
		zadd: vi.fn(),
		zrangebyscore: vi.fn(),
		zremrangebyscore: vi.fn(),
		zcard: vi.fn(),
		zrem: vi.fn(),
		del: vi.fn(),
		// The adapter uses redis.call("SET", ...) to work around ioredis overloads
		call: vi.fn(),
		get: vi.fn(),
		exists: vi.fn(),
		expire: vi.fn(),
		hset: vi.fn(),
		hgetall: vi.fn(),
		hdel: vi.fn(),
		scan: vi.fn(),
		multi: vi.fn(),
		ping: vi.fn(),
		quit: vi.fn(),
	};
}

type MockIoRedis = ReturnType<typeof createMockIoRedis>;

// ---------------------------------------------------------------------------
// Helper: load and instantiate the adapter under test.
// The adapter is expected to accept an ioredis instance in its constructor.
// ---------------------------------------------------------------------------

async function createAdapter(mockIoRedis: MockIoRedis): Promise<RedisLike> {
	// Dynamic import so vi.mock hoisting doesn't interfere with test-by-test setup.
	// The adapter is expected at packages/core/src/redis/ioredis-adapter.ts
	const { IoRedisAdapter } = await import("../src/redis/ioredis-adapter");
	// biome-ignore lint/suspicious/noExplicitAny: test-only cast to inject mock
	return new IoRedisAdapter(mockIoRedis as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IoRedisAdapter", () => {
	let mockIoRedis: MockIoRedis;
	let adapter: RedisLike;

	beforeEach(async () => {
		vi.resetModules();
		mockIoRedis = createMockIoRedis();
		adapter = await createAdapter(mockIoRedis);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -------------------------------------------------------------------------
	// Sorted set methods
	// -------------------------------------------------------------------------

	describe("zadd", () => {
		it("should call ioredis zadd with key, score, member and return the result", async () => {
			mockIoRedis.zadd.mockResolvedValue(1);

			const result = await adapter.zadd("myset", 42, "member1");

			expect(mockIoRedis.zadd).toHaveBeenCalledWith("myset", 42, "member1");
			expect(result).toBe(1);
		});

		it("should return 0 when member already exists (update case)", async () => {
			mockIoRedis.zadd.mockResolvedValue(0);

			const result = await adapter.zadd("myset", 99, "existing");

			expect(result).toBe(0);
		});
	});

	describe("zrangebyscore", () => {
		it("should call ioredis zrangebyscore and return the members array", async () => {
			mockIoRedis.zrangebyscore.mockResolvedValue(["a", "b", "c"]);

			const result = await adapter.zrangebyscore("myset", 1, 10);

			expect(mockIoRedis.zrangebyscore).toHaveBeenCalledWith("myset", 1, 10);
			expect(result).toEqual(["a", "b", "c"]);
		});

		it("should forward string bounds -inf and +inf", async () => {
			mockIoRedis.zrangebyscore.mockResolvedValue([]);

			await adapter.zrangebyscore("myset", "-inf", "+inf");

			expect(mockIoRedis.zrangebyscore).toHaveBeenCalledWith("myset", "-inf", "+inf");
		});

		it("should return empty array when no members match", async () => {
			mockIoRedis.zrangebyscore.mockResolvedValue([]);

			const result = await adapter.zrangebyscore("myset", 100, 200);

			expect(result).toEqual([]);
		});
	});

	describe("zremrangebyscore", () => {
		it("should call ioredis zremrangebyscore and return the removed count", async () => {
			mockIoRedis.zremrangebyscore.mockResolvedValue(3);

			const result = await adapter.zremrangebyscore("myset", 0, 5);

			expect(mockIoRedis.zremrangebyscore).toHaveBeenCalledWith("myset", 0, 5);
			expect(result).toBe(3);
		});

		it("should return 0 when no members fall in range", async () => {
			mockIoRedis.zremrangebyscore.mockResolvedValue(0);

			const result = await adapter.zremrangebyscore("myset", 999, 1000);

			expect(result).toBe(0);
		});
	});

	describe("zcard", () => {
		it("should call ioredis zcard and return the cardinality", async () => {
			mockIoRedis.zcard.mockResolvedValue(5);

			const result = await adapter.zcard("myset");

			expect(mockIoRedis.zcard).toHaveBeenCalledWith("myset");
			expect(result).toBe(5);
		});

		it("should return 0 for an empty or non-existent key", async () => {
			mockIoRedis.zcard.mockResolvedValue(0);

			const result = await adapter.zcard("nonexistent");

			expect(result).toBe(0);
		});
	});

	describe("zrem", () => {
		it("should call ioredis zrem with key and members and return count", async () => {
			mockIoRedis.zrem.mockResolvedValue(2);

			const result = await adapter.zrem("myset", "a", "b");

			expect(mockIoRedis.zrem).toHaveBeenCalledWith("myset", "a", "b");
			expect(result).toBe(2);
		});

		it("should handle single member removal", async () => {
			mockIoRedis.zrem.mockResolvedValue(1);

			const result = await adapter.zrem("myset", "only");

			expect(mockIoRedis.zrem).toHaveBeenCalledWith("myset", "only");
			expect(result).toBe(1);
		});

		it("should return 0 when member does not exist", async () => {
			mockIoRedis.zrem.mockResolvedValue(0);

			const result = await adapter.zrem("myset", "ghost");

			expect(result).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// String / key methods
	// -------------------------------------------------------------------------

	describe("set", () => {
		it("should delegate to ioredis.call('SET', ...) with key and value and return OK", async () => {
			mockIoRedis.call.mockResolvedValue("OK");

			const result = await adapter.set("mykey", "myvalue");

			expect(mockIoRedis.call).toHaveBeenCalledWith("SET", "mykey", "myvalue");
			expect(result).toBe("OK");
		});

		it("should forward extra args (NX, EX) via ioredis.call", async () => {
			mockIoRedis.call.mockResolvedValue("OK");

			await adapter.set("lockkey", "1", "NX", "EX", 30);

			expect(mockIoRedis.call).toHaveBeenCalledWith("SET", "lockkey", "1", "NX", "EX", 30);
		});

		it("should return null when NX condition is not met", async () => {
			mockIoRedis.call.mockResolvedValue(null);

			const result = await adapter.set("existingkey", "value", "NX");

			expect(result).toBeNull();
		});
	});

	describe("get", () => {
		it("should call ioredis get and return the value", async () => {
			mockIoRedis.get.mockResolvedValue("stored-value");

			const result = await adapter.get("mykey");

			expect(mockIoRedis.get).toHaveBeenCalledWith("mykey");
			expect(result).toBe("stored-value");
		});

		it("should return null for non-existent key", async () => {
			mockIoRedis.get.mockResolvedValue(null);

			const result = await adapter.get("missing");

			expect(result).toBeNull();
		});
	});

	describe("del", () => {
		it("should call ioredis del and return deletion count", async () => {
			mockIoRedis.del.mockResolvedValue(1);

			const result = await adapter.del("mykey");

			expect(mockIoRedis.del).toHaveBeenCalledWith("mykey");
			expect(result).toBe(1);
		});

		it("should return 0 when key does not exist", async () => {
			mockIoRedis.del.mockResolvedValue(0);

			const result = await adapter.del("ghost");

			expect(result).toBe(0);
		});
	});

	describe("exists", () => {
		it("should call ioredis exists and return 1 when key exists", async () => {
			mockIoRedis.exists.mockResolvedValue(1);

			const result = await adapter.exists("present");

			expect(mockIoRedis.exists).toHaveBeenCalledWith("present");
			expect(result).toBe(1);
		});

		it("should return 0 when key does not exist", async () => {
			mockIoRedis.exists.mockResolvedValue(0);

			const result = await adapter.exists("absent");

			expect(result).toBe(0);
		});
	});

	describe("expire", () => {
		it("should call ioredis expire with key and seconds and return 1", async () => {
			mockIoRedis.expire.mockResolvedValue(1);

			const result = await adapter.expire("mykey", 60);

			expect(mockIoRedis.expire).toHaveBeenCalledWith("mykey", 60);
			expect(result).toBe(1);
		});

		it("should return 0 when key does not exist", async () => {
			mockIoRedis.expire.mockResolvedValue(0);

			const result = await adapter.expire("ghost", 60);

			expect(result).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// Hash methods
	// -------------------------------------------------------------------------

	describe("hset", () => {
		it("should call ioredis hset with key, field, value and return the result", async () => {
			mockIoRedis.hset.mockResolvedValue(1);

			const result = await adapter.hset("myhash", "field1", "value1");

			expect(mockIoRedis.hset).toHaveBeenCalledWith("myhash", "field1", "value1");
			expect(result).toBe(1);
		});

		it("should return 0 when field already exists (update case)", async () => {
			mockIoRedis.hset.mockResolvedValue(0);

			const result = await adapter.hset("myhash", "existing", "newval");

			expect(result).toBe(0);
		});
	});

	describe("hgetall", () => {
		it("should call ioredis hgetall and return the hash as object", async () => {
			mockIoRedis.hgetall.mockResolvedValue({ state: "open", failures: "5" });

			const result = await adapter.hgetall("myhash");

			expect(mockIoRedis.hgetall).toHaveBeenCalledWith("myhash");
			expect(result).toEqual({ state: "open", failures: "5" });
		});

		it("should return empty object for non-existent key", async () => {
			mockIoRedis.hgetall.mockResolvedValue({});

			const result = await adapter.hgetall("missing");

			expect(result).toEqual({});
		});
	});

	describe("hdel", () => {
		it("should call ioredis hdel with key and fields and return count", async () => {
			mockIoRedis.hdel.mockResolvedValue(2);

			const result = await adapter.hdel("myhash", "f1", "f2");

			expect(mockIoRedis.hdel).toHaveBeenCalledWith("myhash", "f1", "f2");
			expect(result).toBe(2);
		});

		it("should return 0 when fields do not exist", async () => {
			mockIoRedis.hdel.mockResolvedValue(0);

			const result = await adapter.hdel("myhash", "ghost");

			expect(result).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// scan() — positional signature adapter mapping
	// -------------------------------------------------------------------------

	describe("scan", () => {
		it("should map positional (cursor, pattern, count) to ioredis variadic scan", async () => {
			mockIoRedis.scan.mockResolvedValue(["0", ["key:1", "key:2"]]);

			const result = await adapter.scan("0", "key:*", 100);

			// ioredis scan takes: cursor (as number), 'MATCH', pattern, 'COUNT', count
			expect(mockIoRedis.scan).toHaveBeenCalledWith(0, "MATCH", "key:*", "COUNT", 100);
			expect(result).toEqual(["0", ["key:1", "key:2"]]);
		});

		it("should return next cursor when more keys remain", async () => {
			mockIoRedis.scan.mockResolvedValue(["42", ["key:3"]]);

			const [nextCursor, keys] = await adapter.scan("0", "key:*", 10);

			expect(nextCursor).toBe("42");
			expect(keys).toEqual(["key:3"]);
		});

		it("should return cursor '0' and empty array when no keys match", async () => {
			mockIoRedis.scan.mockResolvedValue(["0", []]);

			const [cursor, keys] = await adapter.scan("0", "emito:nonexistent:*", 100);

			expect(cursor).toBe("0");
			expect(keys).toEqual([]);
		});
	});

	// -------------------------------------------------------------------------
	// ping / quit
	// -------------------------------------------------------------------------

	describe("ping", () => {
		it("should call ioredis ping and return PONG", async () => {
			mockIoRedis.ping.mockResolvedValue("PONG");

			const result = await adapter.ping();

			expect(mockIoRedis.ping).toHaveBeenCalled();
			expect(result).toBe("PONG");
		});
	});

	describe("quit", () => {
		it("should call ioredis quit and return OK", async () => {
			mockIoRedis.quit.mockResolvedValue("OK");

			const result = await adapter.quit();

			expect(mockIoRedis.quit).toHaveBeenCalled();
			expect(result).toBe("OK");
		});
	});

	// -------------------------------------------------------------------------
	// multi() — MULTI/EXEC pipeline
	// -------------------------------------------------------------------------

	describe("multi", () => {
		it("should return a RedisMulti-compatible chainable pipeline", () => {
			const mockPipeline = {
				zadd: vi.fn().mockReturnThis(),
				zrangebyscore: vi.fn().mockReturnThis(),
				zremrangebyscore: vi.fn().mockReturnThis(),
				zcard: vi.fn().mockReturnThis(),
				del: vi.fn().mockReturnThis(),
				expire: vi.fn().mockReturnThis(),
				zrem: vi.fn().mockReturnThis(),
				hset: vi.fn().mockReturnThis(),
				hdel: vi.fn().mockReturnThis(),
				exec: vi.fn().mockResolvedValue([[null, 1]]),
			};
			mockIoRedis.multi.mockReturnValue(mockPipeline);

			const multi = adapter.multi();

			expect(mockIoRedis.multi).toHaveBeenCalled();
			expect(multi).toBeDefined();
		});

		it("should chain multi methods and call exec to get results", async () => {
			const mockPipeline = {
				zadd: vi.fn().mockReturnThis(),
				zrangebyscore: vi.fn().mockReturnThis(),
				zremrangebyscore: vi.fn().mockReturnThis(),
				zcard: vi.fn().mockReturnThis(),
				del: vi.fn().mockReturnThis(),
				expire: vi.fn().mockReturnThis(),
				zrem: vi.fn().mockReturnThis(),
				hset: vi.fn().mockReturnThis(),
				hdel: vi.fn().mockReturnThis(),
				exec: vi.fn().mockResolvedValue([
					[null, 1],
					[null, 2],
				]),
			};
			mockIoRedis.multi.mockReturnValue(mockPipeline);

			const results = await adapter.multi().zadd("k", 1, "a").zcard("k").exec();

			expect(results).toEqual([
				[null, 1],
				[null, 2],
			]);
		});

		it("should forward zadd args through the pipeline", async () => {
			const mockPipeline = {
				zadd: vi.fn().mockReturnThis(),
				zrangebyscore: vi.fn().mockReturnThis(),
				zremrangebyscore: vi.fn().mockReturnThis(),
				zcard: vi.fn().mockReturnThis(),
				del: vi.fn().mockReturnThis(),
				expire: vi.fn().mockReturnThis(),
				zrem: vi.fn().mockReturnThis(),
				hset: vi.fn().mockReturnThis(),
				hdel: vi.fn().mockReturnThis(),
				exec: vi.fn().mockResolvedValue([[null, 1]]),
			};
			mockIoRedis.multi.mockReturnValue(mockPipeline);

			adapter.multi().zadd("myset", 99, "member");

			expect(mockPipeline.zadd).toHaveBeenCalledWith("myset", 99, "member");
		});
	});

	// -------------------------------------------------------------------------
	// Implements the RedisLike interface (type-level check via assignment)
	// -------------------------------------------------------------------------

	it("should satisfy the RedisLike interface at runtime", () => {
		// All required methods must be present and callable
		expect(typeof adapter.zadd).toBe("function");
		expect(typeof adapter.zrangebyscore).toBe("function");
		expect(typeof adapter.zremrangebyscore).toBe("function");
		expect(typeof adapter.zcard).toBe("function");
		expect(typeof adapter.zrem).toBe("function");
		expect(typeof adapter.del).toBe("function");
		// set delegates to redis.call() internally — still exposed publicly
		expect(typeof adapter.set).toBe("function");
		expect(typeof adapter.get).toBe("function");
		expect(typeof adapter.exists).toBe("function");
		expect(typeof adapter.expire).toBe("function");
		expect(typeof adapter.hset).toBe("function");
		expect(typeof adapter.hgetall).toBe("function");
		expect(typeof adapter.hdel).toBe("function");
		expect(typeof adapter.scan).toBe("function");
		expect(typeof adapter.multi).toBe("function");
		expect(typeof adapter.ping).toBe("function");
		expect(typeof adapter.quit).toBe("function");
	});
});
