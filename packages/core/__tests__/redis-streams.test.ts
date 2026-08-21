/**
 * Tests for Redis Streams methods on MockRedis and IoRedisAdapter.
 *
 * MockRedis coverage:
 * - xadd: appends entries, returns auto-generated ID, supports '*' and explicit IDs
 * - xread: returns entries after a given ID, respects count, returns null when empty
 * - xrange: returns entries in [start, end] range, respects count
 * - xlen: returns entry count
 * - xtrim: MAXLEN strategy trims oldest entries; MINID strategy removes entries below ID
 *
 * IoRedisAdapter coverage:
 * - Each method delegates to the ioredis instance with correct arguments.
 *
 * Rules applied:
 * - Never mock the module under test (rule 10)
 * - Use MockRedis for unit tests (rule 11)
 * - Assert on call arguments for mock verifications (rule 28)
 * - Prefer specific matchers (rule 25)
 * - Test boundary conditions (rule 4)
 * - Reset all mocks in afterEach (rule 14)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisLike } from "../src/redis/types";
import { createMockRedis } from "./helpers/mock-redis";

// ---------------------------------------------------------------------------
// MockRedis — Redis Streams
// ---------------------------------------------------------------------------

describe("MockRedis — Redis Streams", () => {
	let redis: ReturnType<typeof createMockRedis>;

	beforeEach(() => {
		redis = createMockRedis();
	});

	afterEach(() => {
		redis.clear();
		vi.restoreAllMocks();
	});

	// -------------------------------------------------------------------------
	// xadd
	// -------------------------------------------------------------------------

	describe("xadd", () => {
		it("should return a non-empty string ID when called with '*'", async () => {
			const id = await redis.xadd("mystream", "*", "field1", "value1");

			expect(typeof id).toBe("string");
			expect(id.length).toBeGreaterThan(0);
		});

		it("should return the explicit ID when one is provided", async () => {
			const id = await redis.xadd("mystream", "1000-0", "field1", "value1");

			expect(id).toBe("1000-0");
		});

		it("should increase xlen after each xadd", async () => {
			await redis.xadd("mystream", "*", "f", "v1");
			await redis.xadd("mystream", "*", "f", "v2");

			const len = await redis.xlen("mystream");

			expect(len).toBe(2);
		});

		it("should store multiple field-value pairs per entry", async () => {
			await redis.xadd("mystream", "1-0", "event", "notification", "data", `{"id":"n1"}`);

			const entries = await redis.xrange("mystream", "-", "+");

			expect(entries).toHaveLength(1);
			expect(entries[0][0]).toBe("1-0");
			// Fields stored as flat array: [field, value, field, value, ...]
			expect(entries[0][1]).toEqual(["event", "notification", "data", `{"id":"n1"}`]);
		});

		it("should return '0' length for a key that was never written to", async () => {
			const len = await redis.xlen("nonexistent");

			expect(len).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// xread
	// -------------------------------------------------------------------------

	describe("xread", () => {
		it("should return null when stream does not exist", async () => {
			const result = await redis.xread([{ key: "missing", id: "0-0" }]);

			expect(result).toBeNull();
		});

		it("should return null when no new entries exist after the given ID", async () => {
			await redis.xadd("mystream", "1-0", "f", "v");
			// Reading after the entry that exists returns null
			const result = await redis.xread([{ key: "mystream", id: "1-0" }]);

			expect(result).toBeNull();
		});

		it("should return entries added after the given ID", async () => {
			await redis.xadd("mystream", "1-0", "f", "first");
			await redis.xadd("mystream", "2-0", "f", "second");
			await redis.xadd("mystream", "3-0", "f", "third");

			// Read after 1-0 — should get 2-0 and 3-0
			const result = await redis.xread([{ key: "mystream", id: "1-0" }]);

			expect(result).not.toBeNull();
			expect(result).toHaveLength(1); // one key in result
			const [streamKey, entries] = result![0];
			expect(streamKey).toBe("mystream");
			expect(entries).toHaveLength(2);
			expect(entries[0][0]).toBe("2-0");
			expect(entries[1][0]).toBe("3-0");
		});

		it("should respect count and return at most count entries", async () => {
			await redis.xadd("mystream", "1-0", "f", "v1");
			await redis.xadd("mystream", "2-0", "f", "v2");
			await redis.xadd("mystream", "3-0", "f", "v3");

			const result = await redis.xread([{ key: "mystream", id: "0-0", count: 2 }]);

			expect(result).not.toBeNull();
			const [, entries] = result![0];
			expect(entries).toHaveLength(2);
			expect(entries[0][0]).toBe("1-0");
			expect(entries[1][0]).toBe("2-0");
		});

		it("should handle ID '0-0' and return all entries from the beginning", async () => {
			await redis.xadd("mystream", "1-0", "f", "v");

			const result = await redis.xread([{ key: "mystream", id: "0-0" }]);

			expect(result).not.toBeNull();
			const [, entries] = result![0];
			expect(entries).toHaveLength(1);
			expect(entries[0][0]).toBe("1-0");
		});

		it("should handle multiple keys in a single xread call", async () => {
			await redis.xadd("stream:a", "1-0", "f", "va");
			await redis.xadd("stream:b", "1-0", "f", "vb");

			const result = await redis.xread([
				{ key: "stream:a", id: "0-0" },
				{ key: "stream:b", id: "0-0" },
			]);

			expect(result).not.toBeNull();
			expect(result).toHaveLength(2);
			const keys = result!.map(([k]) => k);
			expect(keys).toContain("stream:a");
			expect(keys).toContain("stream:b");
		});
	});

	// -------------------------------------------------------------------------
	// xrange
	// -------------------------------------------------------------------------

	describe("xrange", () => {
		it("should return empty array for non-existent stream", async () => {
			const result = await redis.xrange("missing", "-", "+");

			expect(result).toEqual([]);
		});

		it("should return all entries when using '-' and '+' bounds", async () => {
			await redis.xadd("mystream", "1-0", "f", "v1");
			await redis.xadd("mystream", "2-0", "f", "v2");

			const result = await redis.xrange("mystream", "-", "+");

			expect(result).toHaveLength(2);
			expect(result[0][0]).toBe("1-0");
			expect(result[1][0]).toBe("2-0");
		});

		it("should return only entries within the ID range (inclusive on both ends)", async () => {
			await redis.xadd("mystream", "1-0", "f", "v1");
			await redis.xadd("mystream", "2-0", "f", "v2");
			await redis.xadd("mystream", "3-0", "f", "v3");

			const result = await redis.xrange("mystream", "1-0", "2-0");

			expect(result).toHaveLength(2);
			expect(result[0][0]).toBe("1-0");
			expect(result[1][0]).toBe("2-0");
		});

		it("should respect count and return at most count entries", async () => {
			await redis.xadd("mystream", "1-0", "f", "v1");
			await redis.xadd("mystream", "2-0", "f", "v2");
			await redis.xadd("mystream", "3-0", "f", "v3");

			const result = await redis.xrange("mystream", "-", "+", 2);

			expect(result).toHaveLength(2);
			expect(result[0][0]).toBe("1-0");
			expect(result[1][0]).toBe("2-0");
		});

		it("should return entries in ascending ID order", async () => {
			// Insert in reverse order to verify sorting
			await redis.xadd("mystream", "3-0", "f", "v3");
			await redis.xadd("mystream", "1-0", "f", "v1");
			await redis.xadd("mystream", "2-0", "f", "v2");

			const result = await redis.xrange("mystream", "-", "+");

			expect(result[0][0]).toBe("1-0");
			expect(result[1][0]).toBe("2-0");
			expect(result[2][0]).toBe("3-0");
		});
	});

	// -------------------------------------------------------------------------
	// xlen
	// -------------------------------------------------------------------------

	describe("xlen", () => {
		it("should return 0 for a non-existent stream", async () => {
			const len = await redis.xlen("nonexistent");

			expect(len).toBe(0);
		});

		it("should return 1 after a single xadd", async () => {
			await redis.xadd("mystream", "*", "f", "v");

			expect(await redis.xlen("mystream")).toBe(1);
		});

		it("should count all entries correctly", async () => {
			for (let i = 1; i <= 5; i++) {
				await redis.xadd("mystream", `${i}-0`, "f", `v${i}`);
			}

			expect(await redis.xlen("mystream")).toBe(5);
		});
	});

	// -------------------------------------------------------------------------
	// xtrim
	// -------------------------------------------------------------------------

	describe("xtrim", () => {
		it("should return 0 when stream does not exist", async () => {
			const removed = await redis.xtrim("nonexistent", "MAXLEN", 100);

			expect(removed).toBe(0);
		});

		it("should return 0 when stream length is within MAXLEN", async () => {
			await redis.xadd("mystream", "1-0", "f", "v");
			await redis.xadd("mystream", "2-0", "f", "v");

			const removed = await redis.xtrim("mystream", "MAXLEN", 10);

			expect(removed).toBe(0);
			expect(await redis.xlen("mystream")).toBe(2);
		});

		it("should trim to MAXLEN, removing oldest entries first", async () => {
			for (let i = 1; i <= 5; i++) {
				await redis.xadd("mystream", `${i}-0`, "f", `v${i}`);
			}

			const removed = await redis.xtrim("mystream", "MAXLEN", 3);

			expect(removed).toBe(2);
			expect(await redis.xlen("mystream")).toBe(3);

			// Oldest (1-0 and 2-0) should be gone; 3-0, 4-0, 5-0 remain
			const remaining = await redis.xrange("mystream", "-", "+");
			expect(remaining[0][0]).toBe("3-0");
			expect(remaining[2][0]).toBe("5-0");
		});

		it("should remove all entries when MAXLEN is 0", async () => {
			await redis.xadd("mystream", "1-0", "f", "v");
			await redis.xadd("mystream", "2-0", "f", "v");

			const removed = await redis.xtrim("mystream", "MAXLEN", 0);

			expect(removed).toBe(2);
			expect(await redis.xlen("mystream")).toBe(0);
		});

		it("should trim by MINID, removing entries with IDs below the threshold", async () => {
			await redis.xadd("mystream", "1-0", "f", "v1");
			await redis.xadd("mystream", "2-0", "f", "v2");
			await redis.xadd("mystream", "3-0", "f", "v3");

			// Remove all entries with ID < "3-0"
			const removed = await redis.xtrim("mystream", "MINID", "3-0");

			expect(removed).toBe(2);
			expect(await redis.xlen("mystream")).toBe(1);

			const remaining = await redis.xrange("mystream", "-", "+");
			expect(remaining[0][0]).toBe("3-0");
		});
	});
});

// ---------------------------------------------------------------------------
// IoRedisAdapter — Redis Streams
// ---------------------------------------------------------------------------

function createMockIoRedis() {
	return {
		zadd: vi.fn(),
		zrangebyscore: vi.fn(),
		zremrangebyscore: vi.fn(),
		zcard: vi.fn(),
		zrem: vi.fn(),
		del: vi.fn(),
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
		xadd: vi.fn(),
		xread: vi.fn(),
		xrange: vi.fn(),
		xlen: vi.fn(),
		xtrim: vi.fn(),
	};
}

type MockIoRedis = ReturnType<typeof createMockIoRedis>;

async function createAdapter(mockIoRedis: MockIoRedis): Promise<RedisLike> {
	const { IoRedisAdapter } = await import("../src/redis/ioredis-adapter");
	// biome-ignore lint/suspicious/noExplicitAny: test-only cast to inject mock
	return new IoRedisAdapter(mockIoRedis as any);
}

describe("IoRedisAdapter — Redis Streams", () => {
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

	describe("xadd", () => {
		it("should call ioredis xadd with key, id, and field-value pairs and return the ID", async () => {
			mockIoRedis.xadd.mockResolvedValue("1000-0");

			const result = await adapter.xadd("mystream", "*", "event", "notification");

			expect(mockIoRedis.xadd).toHaveBeenCalledWith("mystream", "*", "event", "notification");
			expect(result).toBe("1000-0");
		});

		it("should forward multiple field-value pairs", async () => {
			mockIoRedis.xadd.mockResolvedValue("2000-0");

			await adapter.xadd("mystream", "*", "f1", "v1", "f2", "v2");

			expect(mockIoRedis.xadd).toHaveBeenCalledWith("mystream", "*", "f1", "v1", "f2", "v2");
		});
	});

	describe("xread", () => {
		it("should call redis.call('XREAD', 'STREAMS', key, id) and return result", async () => {
			const ioredisResult = [["mystream", [["1-0", ["f", "v"]]]]];
			mockIoRedis.call.mockResolvedValue(ioredisResult);

			const result = await adapter.xread([{ key: "mystream", id: "0-0" }]);

			expect(mockIoRedis.call).toHaveBeenCalledWith("XREAD", "STREAMS", "mystream", "0-0");
			expect(result).toEqual([["mystream", [["1-0", ["f", "v"]]]]]);
		});

		it("should include COUNT before STREAMS when count is provided", async () => {
			mockIoRedis.call.mockResolvedValue(null);

			await adapter.xread([{ key: "mystream", id: "0-0", count: 10 }]);

			const callArgs = mockIoRedis.call.mock.calls[0];
			expect(callArgs).toEqual(["XREAD", "COUNT", 10, "STREAMS", "mystream", "0-0"]);
		});

		it("should include BLOCK before STREAMS when block is provided", async () => {
			mockIoRedis.call.mockResolvedValue(null);

			await adapter.xread([{ key: "mystream", id: "$", block: 0 }]);

			const callArgs = mockIoRedis.call.mock.calls[0];
			expect(callArgs).toEqual(["XREAD", "BLOCK", 0, "STREAMS", "mystream", "$"]);
		});

		it("should return null when ioredis returns null", async () => {
			mockIoRedis.call.mockResolvedValue(null);

			const result = await adapter.xread([{ key: "mystream", id: "0-0" }]);

			expect(result).toBeNull();
		});

		it("should handle multiple keys — place all keys then all IDs after STREAMS", async () => {
			mockIoRedis.call.mockResolvedValue(null);

			await adapter.xread([
				{ key: "stream:a", id: "1-0" },
				{ key: "stream:b", id: "2-0" },
			]);

			const callArgs = mockIoRedis.call.mock.calls[0];
			expect(callArgs).toEqual(["XREAD", "STREAMS", "stream:a", "stream:b", "1-0", "2-0"]);
		});
	});

	describe("xrange", () => {
		it("should call ioredis xrange with key, start, end and return entries", async () => {
			const entries = [["1-0", ["f", "v"]]];
			mockIoRedis.xrange.mockResolvedValue(entries);

			const result = await adapter.xrange("mystream", "-", "+");

			expect(mockIoRedis.xrange).toHaveBeenCalledWith("mystream", "-", "+");
			expect(result).toEqual(entries);
		});

		it("should include COUNT when count is provided", async () => {
			mockIoRedis.xrange.mockResolvedValue([]);

			await adapter.xrange("mystream", "-", "+", 5);

			expect(mockIoRedis.xrange).toHaveBeenCalledWith("mystream", "-", "+", "COUNT", 5);
		});

		it("should return empty array when ioredis returns empty array", async () => {
			mockIoRedis.xrange.mockResolvedValue([]);

			const result = await adapter.xrange("mystream", "-", "+");

			expect(result).toEqual([]);
		});
	});

	describe("xlen", () => {
		it("should call ioredis xlen with key and return the count", async () => {
			mockIoRedis.xlen.mockResolvedValue(42);

			const result = await adapter.xlen("mystream");

			expect(mockIoRedis.xlen).toHaveBeenCalledWith("mystream");
			expect(result).toBe(42);
		});

		it("should return 0 when stream is empty", async () => {
			mockIoRedis.xlen.mockResolvedValue(0);

			const result = await adapter.xlen("empty");

			expect(result).toBe(0);
		});
	});

	describe("xtrim", () => {
		it("should call ioredis xtrim(key, 'MAXLEN', threshold) for MAXLEN strategy", async () => {
			mockIoRedis.xtrim.mockResolvedValue(3);

			const result = await adapter.xtrim("mystream", "MAXLEN", 1000);

			expect(mockIoRedis.xtrim).toHaveBeenCalledWith("mystream", "MAXLEN", 1000);
			expect(result).toBe(3);
		});

		it("should call ioredis xtrim(key, 'MINID', threshold) for MINID strategy", async () => {
			mockIoRedis.xtrim.mockResolvedValue(5);

			const result = await adapter.xtrim("mystream", "MINID", "1700000000000-0");

			expect(mockIoRedis.xtrim).toHaveBeenCalledWith("mystream", "MINID", "1700000000000-0");
			expect(result).toBe(5);
		});

		it("should return 0 when no entries were trimmed", async () => {
			mockIoRedis.xtrim.mockResolvedValue(0);

			const result = await adapter.xtrim("mystream", "MAXLEN", 1000);

			expect(result).toBe(0);
		});
	});

	it("should satisfy the Redis Streams interface at runtime", async () => {
		expect(typeof adapter.xadd).toBe("function");
		expect(typeof adapter.xread).toBe("function");
		expect(typeof adapter.xrange).toBe("function");
		expect(typeof adapter.xlen).toBe("function");
		expect(typeof adapter.xtrim).toBe("function");
	});
});
