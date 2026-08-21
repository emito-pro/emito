/**
 * Chainable Redis MULTI/EXEC transaction.
 * Each method queues a command and returns `this` for chaining.
 * Call `exec()` to execute all queued commands atomically.
 */
export interface RedisMulti {
	zadd(key: string, score: number, member: string): this;
	zrangebyscore(key: string, min: string | number, max: string | number): this;
	zremrangebyscore(key: string, min: string | number, max: string | number): this;
	zcard(key: string): this;
	del(key: string): this;
	expire(key: string, seconds: number): this;
	zrem(key: string, ...members: string[]): this;
	hset(key: string, field: string, value: string): this;
	hdel(key: string, ...fields: string[]): this;
	exec(): Promise<Array<[Error | null, unknown]>>;
}

/**
 * Minimal Redis client interface (subset of ioredis).
 * Covers sorted sets, strings, hashes, TTL, and MULTI transactions
 * used by rate limiter, digest engine, and circuit breaker.
 */
export interface RedisLike {
	zadd(key: string, score: number, member: string): Promise<number>;
	zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]>;
	zremrangebyscore(key: string, min: string | number, max: string | number): Promise<number>;
	zcard(key: string): Promise<number>;
	zrem(key: string, ...members: string[]): Promise<number>;
	del(key: string): Promise<number>;
	set(key: string, value: string, ...args: unknown[]): Promise<string | null>;
	get(key: string): Promise<string | null>;
	exists(key: string): Promise<number>;
	expire(key: string, seconds: number): Promise<number>;
	hset(key: string, field: string, value: string): Promise<number>;
	hgetall(key: string): Promise<Record<string, string>>;
	hdel(key: string, ...fields: string[]): Promise<number>;
	scan(cursor: string, pattern: string, count: number): Promise<[string, string[]]>;
	/**
	 * Cluster-aware SCAN that iterates all nodes.
	 * Same signature as scan() but guarantees coverage of all shards in Redis Cluster.
	 * Optional — when absent, the engine falls back to regular scan().
	 */
	scanAll?(cursor: string, pattern: string, count: number): Promise<[string, string[]]>;
	// Redis Streams
	xadd(key: string, id: string, ...fieldsAndValues: string[]): Promise<string>;
	xread(
		args: Array<{ key: string; id: string; count?: number; block?: number }>,
	): Promise<Array<[string, Array<[string, string[]]>]> | null>;
	xrange(
		key: string,
		start: string,
		end: string,
		count?: number,
	): Promise<Array<[string, string[]]>>;
	xlen(key: string): Promise<number>;
	xtrim(key: string, strategy: "MAXLEN" | "MINID", threshold: number | string): Promise<number>;

	multi(): RedisMulti;
	ping(): Promise<string>;
	quit(): Promise<string>;
}
