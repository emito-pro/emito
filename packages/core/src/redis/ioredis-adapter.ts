import type Redis from "ioredis";
import type { Cluster } from "ioredis";
import type { RedisLike, RedisMulti } from "./types";

/**
 * Detect whether an ioredis instance is a Cluster.
 */
function isCluster(redis: Redis | Cluster): redis is Cluster {
	return "nodes" in redis && typeof (redis as Cluster).nodes === "function";
}

/**
 * Wrap an ioredis MULTI chain to conform to RedisMulti.
 */
function wrapMulti(pipeline: ReturnType<Redis["multi"]>): RedisMulti {
	const chain: RedisMulti = {
		zadd(key: string, score: number, member: string) {
			pipeline.zadd(key, score, member);
			return chain;
		},
		zrangebyscore(key: string, min: string | number, max: string | number) {
			pipeline.zrangebyscore(key, min, max);
			return chain;
		},
		zremrangebyscore(key: string, min: string | number, max: string | number) {
			pipeline.zremrangebyscore(key, min, max);
			return chain;
		},
		zcard(key: string) {
			pipeline.zcard(key);
			return chain;
		},
		del(key: string) {
			pipeline.del(key);
			return chain;
		},
		expire(key: string, seconds: number) {
			pipeline.expire(key, seconds);
			return chain;
		},
		zrem(key: string, ...members: string[]) {
			pipeline.zrem(key, ...members);
			return chain;
		},
		hset(key: string, field: string, value: string) {
			pipeline.hset(key, field, value);
			return chain;
		},
		hdel(key: string, ...fields: string[]) {
			pipeline.hdel(key, ...fields);
			return chain;
		},
		async exec(): Promise<Array<[Error | null, unknown]>> {
			const results = await pipeline.exec();
			return (results ?? []) as Array<[Error | null, unknown]>;
		},
	};
	return chain;
}

/**
 * Collect all keys matching a pattern from a scanStream.
 */
function collectScanStream(redis: Redis, pattern: string, count: number): Promise<string[]> {
	return new Promise<string[]>((resolve, reject) => {
		const keys: string[] = [];
		const stream = redis.scanStream({ match: pattern, count });
		stream.on("data", (batch: string[]) => {
			keys.push(...batch);
		});
		stream.on("end", () => resolve(keys));
		stream.on("error", (err: Error) => reject(err));
	});
}

/**
 * Thin adapter wrapping a real ioredis instance to conform to the RedisLike interface.
 * Does NOT manage the connection — the caller owns the ioredis lifecycle.
 */
export class IoRedisAdapter implements RedisLike {
	constructor(private readonly redis: Redis | Cluster) {}

	async zadd(key: string, score: number, member: string): Promise<number> {
		return this.redis.zadd(key, score, member);
	}

	async zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]> {
		return this.redis.zrangebyscore(key, min, max);
	}

	async zremrangebyscore(key: string, min: string | number, max: string | number): Promise<number> {
		return this.redis.zremrangebyscore(key, min, max);
	}

	async zcard(key: string): Promise<number> {
		return this.redis.zcard(key);
	}

	async zrem(key: string, ...members: string[]): Promise<number> {
		return this.redis.zrem(key, ...members);
	}

	async del(key: string): Promise<number> {
		return this.redis.del(key);
	}

	async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
		// ioredis set() has complex overloads; cast args to bypass type mismatch
		const castArgs = args as (string | number)[];
		const redis = this.redis as Redis;
		return redis.call("SET", key, value, ...castArgs) as Promise<string | null>;
	}

	async get(key: string): Promise<string | null> {
		return this.redis.get(key);
	}

	async exists(key: string): Promise<number> {
		return this.redis.exists(key);
	}

	async expire(key: string, seconds: number): Promise<number> {
		return this.redis.expire(key, seconds);
	}

	async hset(key: string, field: string, value: string): Promise<number> {
		return this.redis.hset(key, field, value);
	}

	async hgetall(key: string): Promise<Record<string, string>> {
		return (await this.redis.hgetall(key)) ?? {};
	}

	async hdel(key: string, ...fields: string[]): Promise<number> {
		return this.redis.hdel(key, ...fields);
	}

	async scan(cursor: string, pattern: string, count: number): Promise<[string, string[]]> {
		const result = await this.redis.scan(Number(cursor), "MATCH", pattern, "COUNT", count);
		return [result[0], result[1]];
	}

	async scanAll(_cursor: string, pattern: string, count: number): Promise<[string, string[]]> {
		if (isCluster(this.redis)) {
			const masters = this.redis.nodes("master");
			const allKeys: string[] = [];
			for (const node of masters) {
				const nodeKeys = await collectScanStream(node, pattern, count);
				allKeys.push(...nodeKeys);
			}
			return ["0", allKeys];
		}

		// Single-node: use scanStream to collect all keys in one call
		const keys = await collectScanStream(this.redis as Redis, pattern, count);
		return ["0", keys];
	}

	async xadd(key: string, id: string, ...fieldsAndValues: string[]): Promise<string> {
		const result = await this.redis.xadd(key, id, ...fieldsAndValues);
		return result as string;
	}

	async xread(
		args: Array<{ key: string; id: string; count?: number; block?: number }>,
	): Promise<Array<[string, Array<[string, string[]]>]> | null> {
		const redis = this.redis as Redis;

		// Build ioredis call args: [BLOCK ms] [COUNT n] STREAMS key1 key2 ... id1 id2 ...
		const callArgs: (string | number)[] = [];

		const firstBlock = args.find((a) => a.block !== undefined);
		if (firstBlock?.block !== undefined) {
			callArgs.push("BLOCK", firstBlock.block);
		}

		const firstCount = args.find((a) => a.count !== undefined);
		if (firstCount?.count !== undefined) {
			callArgs.push("COUNT", firstCount.count);
		}

		callArgs.push("STREAMS");
		for (const a of args) callArgs.push(a.key);
		for (const a of args) callArgs.push(a.id);

		const result = await redis.call("XREAD", ...callArgs);
		return result as Array<[string, Array<[string, string[]]>]> | null;
	}

	async xrange(
		key: string,
		start: string,
		end: string,
		count?: number,
	): Promise<Array<[string, string[]]>> {
		if (count !== undefined) {
			return this.redis.xrange(key, start, end, "COUNT", count) as Promise<
				Array<[string, string[]]>
			>;
		}
		return this.redis.xrange(key, start, end) as Promise<Array<[string, string[]]>>;
	}

	async xlen(key: string): Promise<number> {
		return this.redis.xlen(key);
	}

	async xtrim(
		key: string,
		strategy: "MAXLEN" | "MINID",
		threshold: number | string,
	): Promise<number> {
		if (strategy === "MAXLEN") {
			return this.redis.xtrim(key, "MAXLEN", threshold);
		}
		return this.redis.xtrim(key, "MINID", threshold);
	}

	multi(): RedisMulti {
		return wrapMulti(this.redis.multi());
	}

	async ping(): Promise<string> {
		return this.redis.ping();
	}

	async quit(): Promise<string> {
		return this.redis.quit();
	}
}

/**
 * Create a RedisLike adapter wrapping a real ioredis instance.
 */
export function createRedisAdapter(redis: Redis | Cluster): RedisLike {
	return new IoRedisAdapter(redis);
}
