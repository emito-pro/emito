/**
 * In-memory Redis mock for @emito/core unit tests.
 * Implements the RedisLike interface with sorted sets, strings,
 * TTL tracking, MULTI/EXEC, and SET NX EX (for locks).
 */
import type { RedisLike, RedisMulti } from "../../src/redis/types";

interface SortedSetEntry {
	readonly score: number;
	readonly member: string;
}

type PendingOp = () => unknown;

function compareStreamIds(a: string, b: string): number {
	const [aMs, aSeq = "0"] = a.split("-");
	const [bMs, bSeq = "0"] = b.split("-");
	const msDiff = Number(aMs) - Number(bMs);
	if (msDiff !== 0) return msDiff;
	return Number(aSeq) - Number(bSeq);
}

function parseScore(val: number | string): number {
	if (val === "-inf") return Number.NEGATIVE_INFINITY;
	if (val === "+inf") return Number.POSITIVE_INFINITY;
	return typeof val === "string" ? Number(val) : val;
}

export function createMockRedis(): RedisLike & { clear(): void } {
	const sortedSets = new Map<string, SortedSetEntry[]>();
	const strings = new Map<string, { value: string; expiresAt?: number }>();
	const hashes = new Map<string, Map<string, string>>();
	const streams = new Map<string, Array<[string, string[]]>>();
	const ttls = new Map<string, number>();
	let streamSeq = 0;

	function getSortedSet(key: string): SortedSetEntry[] {
		let set = sortedSets.get(key);
		if (!set) {
			set = [];
			sortedSets.set(key, set);
		}
		return set;
	}

	function isExpired(key: string): boolean {
		const expiry = ttls.get(key);
		if (expiry === undefined) return false;
		return Date.now() > expiry;
	}

	function cleanExpired(key: string): void {
		if (isExpired(key)) {
			sortedSets.delete(key);
			strings.delete(key);
			hashes.delete(key);
			ttls.delete(key);
		}
	}

	function doZadd(key: string, score: number, member: string): number {
		const set = getSortedSet(key);
		const idx = set.findIndex((e) => e.member === member);
		if (idx >= 0) {
			set[idx] = { score, member };
			return 0;
		}
		set.push({ score, member });
		return 1;
	}

	function doZrangebyscore(key: string, min: number | string, max: number | string): string[] {
		const set = sortedSets.get(key);
		if (!set) return [];
		const minNum = parseScore(min);
		const maxNum = parseScore(max);
		return set
			.filter((e) => e.score >= minNum && e.score <= maxNum)
			.sort((a, b) => a.score - b.score)
			.map((e) => e.member);
	}

	function doZremrangebyscore(key: string, min: number | string, max: number | string): number {
		const set = sortedSets.get(key);
		if (!set) return 0;
		const minNum = parseScore(min);
		const maxNum = parseScore(max);
		const before = set.length;
		const filtered = set.filter((e) => e.score < minNum || e.score > maxNum);
		sortedSets.set(key, filtered);
		return before - filtered.length;
	}

	function doZcard(key: string): number {
		const set = sortedSets.get(key);
		return set ? set.length : 0;
	}

	function doZrem(key: string, ...members: string[]): number {
		const set = sortedSets.get(key);
		if (!set) return 0;
		const memberSet = new Set(members);
		const before = set.length;
		const filtered = set.filter((e) => !memberSet.has(e.member));
		sortedSets.set(key, filtered);
		return before - filtered.length;
	}

	function doDel(key: string): number {
		const hadSorted = sortedSets.delete(key);
		const hadString = strings.delete(key);
		const hadHash = hashes.delete(key);
		const hadStream = streams.delete(key);
		ttls.delete(key);
		return hadSorted || hadString || hadHash || hadStream ? 1 : 0;
	}

	function doExpire(key: string, seconds: number): number {
		if (sortedSets.has(key) || strings.has(key) || hashes.has(key)) {
			ttls.set(key, Date.now() + seconds * 1000);
			return 1;
		}
		return 0;
	}

	function doHset(key: string, field: string, value: string): number {
		let hash = hashes.get(key);
		if (!hash) {
			hash = new Map();
			hashes.set(key, hash);
		}
		const isNew = !hash.has(field);
		hash.set(field, value);
		return isNew ? 1 : 0;
	}

	function doHgetall(key: string): Record<string, string> {
		const hash = hashes.get(key);
		if (!hash || hash.size === 0) return {};
		return Object.fromEntries(hash);
	}

	function doHdel(key: string, ...fields: string[]): number {
		const hash = hashes.get(key);
		if (!hash) return 0;
		let removed = 0;
		for (const field of fields) {
			if (hash.delete(field)) removed++;
		}
		if (hash.size === 0) hashes.delete(key);
		return removed;
	}

	const impl: RedisLike & { clear(): void } = {
		async zadd(key: string, score: number, member: string): Promise<number> {
			cleanExpired(key);
			return doZadd(key, score, member);
		},

		async zrangebyscore(
			key: string,
			min: number | string,
			max: number | string,
		): Promise<string[]> {
			cleanExpired(key);
			return doZrangebyscore(key, min, max);
		},

		async zremrangebyscore(
			key: string,
			min: number | string,
			max: number | string,
		): Promise<number> {
			cleanExpired(key);
			return doZremrangebyscore(key, min, max);
		},

		async zcard(key: string): Promise<number> {
			cleanExpired(key);
			return doZcard(key);
		},

		async zrem(key: string, ...members: string[]): Promise<number> {
			cleanExpired(key);
			return doZrem(key, ...members);
		},

		async del(key: string): Promise<number> {
			return doDel(key);
		},

		async expire(key: string, seconds: number): Promise<number> {
			return doExpire(key, seconds);
		},

		async exists(key: string): Promise<number> {
			cleanExpired(key);
			return sortedSets.has(key) || strings.has(key) || hashes.has(key) || streams.has(key) ? 1 : 0;
		},

		async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
			// Parse NX/EX arguments: SET key value NX EX seconds
			let nx = false;
			let exSeconds: number | undefined;

			for (let i = 0; i < args.length; i++) {
				const rawArg = args[i];
				const arg = typeof rawArg === "string" ? rawArg.toUpperCase() : rawArg;
				if (arg === "NX") {
					nx = true;
				} else if (arg === "EX" && i + 1 < args.length) {
					exSeconds = Number(args[i + 1]);
					i++;
				}
			}

			if (nx) {
				cleanExpired(key);
				if (strings.has(key)) {
					return null;
				}
			}

			strings.set(key, { value });
			if (exSeconds !== undefined) {
				ttls.set(key, Date.now() + exSeconds * 1000);
			}
			return "OK";
		},

		async get(key: string): Promise<string | null> {
			cleanExpired(key);
			const entry = strings.get(key);
			return entry ? entry.value : null;
		},

		async hset(key: string, field: string, value: string): Promise<number> {
			cleanExpired(key);
			return doHset(key, field, value);
		},

		async hgetall(key: string): Promise<Record<string, string>> {
			cleanExpired(key);
			return doHgetall(key);
		},

		async hdel(key: string, ...fields: string[]): Promise<number> {
			cleanExpired(key);
			return doHdel(key, ...fields);
		},

		async xadd(key: string, id: string, ...fieldsAndValues: string[]): Promise<string> {
			let stream = streams.get(key);
			if (!stream) {
				stream = [];
				streams.set(key, stream);
			}
			const entryId = id === "*" ? `${Date.now()}-${streamSeq++}` : id;
			stream.push([entryId, fieldsAndValues]);
			return entryId;
		},

		async xread(
			args: Array<{ key: string; id: string; count?: number; block?: number }>,
		): Promise<Array<[string, Array<[string, string[]]>]> | null> {
			// Block mode not supported in mock — return null
			if (args.some((a) => a.block !== undefined)) return null;

			const results: Array<[string, Array<[string, string[]]>]> = [];
			for (const arg of args) {
				const stream = streams.get(arg.key);
				if (!stream) continue;
				const entries = stream.filter(([entryId]) => compareStreamIds(entryId, arg.id) > 0);
				const limited = arg.count !== undefined ? entries.slice(0, arg.count) : entries;
				if (limited.length > 0) {
					results.push([arg.key, limited]);
				}
			}
			return results.length > 0 ? results : null;
		},

		async xrange(
			key: string,
			start: string,
			end: string,
			count?: number,
		): Promise<Array<[string, string[]]>> {
			const stream = streams.get(key);
			if (!stream) return [];
			// Support exclusive range prefix: "(1234-0" means > 1234-0 (exclusive)
			const exclusiveStart = start.startsWith("(");
			const startId = exclusiveStart ? start.slice(1) : start;
			const exclusiveEnd = end.startsWith("(");
			const endId = exclusiveEnd ? end.slice(1) : end;

			let entries = stream
				.filter(([entryId]) => {
					if (startId !== "-") {
						const cmp = compareStreamIds(entryId, startId);
						if (exclusiveStart ? cmp <= 0 : cmp < 0) return false;
					}
					if (endId !== "+") {
						const cmp = compareStreamIds(entryId, endId);
						if (exclusiveEnd ? cmp >= 0 : cmp > 0) return false;
					}
					return true;
				})
				.sort(([a], [b]) => compareStreamIds(a, b));
			if (count !== undefined) entries = entries.slice(0, count);
			return entries;
		},

		async xlen(key: string): Promise<number> {
			const stream = streams.get(key);
			return stream ? stream.length : 0;
		},

		async xtrim(
			key: string,
			strategy: "MAXLEN" | "MINID",
			threshold: number | string,
		): Promise<number> {
			const stream = streams.get(key);
			if (!stream) return 0;
			const before = stream.length;
			if (strategy === "MAXLEN") {
				const maxLen = typeof threshold === "string" ? Number.parseInt(threshold, 10) : threshold;
				if (stream.length > maxLen) {
					stream.splice(0, stream.length - maxLen);
				}
			} else {
				// MINID: remove entries with ID < threshold
				const minId = String(threshold);
				const firstKeep = stream.findIndex(([id]) => compareStreamIds(id, minId) >= 0);
				if (firstKeep > 0) stream.splice(0, firstKeep);
				else if (firstKeep === -1) stream.splice(0, stream.length);
			}
			return before - stream.length;
		},

		async scanAll(cursor: string, pattern: string, count: number): Promise<[string, string[]]> {
			// In mock, scanAll behaves identically to scan — no cluster simulation needed
			return impl.scan(cursor, pattern, count);
		},

		async scan(cursor: string, pattern: string, count: number): Promise<[string, string[]]> {
			// Collect all keys from all stores
			const allKeys = new Set<string>();
			for (const key of sortedSets.keys()) {
				if (!isExpired(key)) allKeys.add(key);
			}
			for (const key of strings.keys()) {
				if (!isExpired(key)) allKeys.add(key);
			}
			for (const key of hashes.keys()) {
				if (!isExpired(key)) allKeys.add(key);
			}
			for (const key of streams.keys()) {
				allKeys.add(key);
			}

			// Convert glob pattern to regex
			const regexStr = pattern
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, ".*")
				.replace(/\?/g, ".");
			const regex = new RegExp(`^${regexStr}$`);

			const matched = [...allKeys].filter((k) => regex.test(k));

			// Simple mock: return all matches in a single pass (cursor "0" means done)
			return ["0", matched];
		},

		multi(): RedisMulti {
			const ops: PendingOp[] = [];

			const chain: RedisMulti = {
				zadd(key: string, score: number, member: string) {
					ops.push(() => doZadd(key, score, member));
					return chain;
				},
				zrangebyscore(key: string, min: number | string, max: number | string) {
					ops.push(() => doZrangebyscore(key, min, max));
					return chain;
				},
				zremrangebyscore(key: string, min: number | string, max: number | string) {
					ops.push(() => doZremrangebyscore(key, min, max));
					return chain;
				},
				zcard(key: string) {
					ops.push(() => doZcard(key));
					return chain;
				},
				zrem(key: string, ...members: string[]) {
					ops.push(() => doZrem(key, ...members));
					return chain;
				},
				hset(key: string, field: string, value: string) {
					ops.push(() => doHset(key, field, value));
					return chain;
				},
				hdel(key: string, ...fields: string[]) {
					ops.push(() => doHdel(key, ...fields));
					return chain;
				},
				del(key: string) {
					ops.push(() => doDel(key));
					return chain;
				},
				expire(key: string, seconds: number) {
					ops.push(() => doExpire(key, seconds));
					return chain;
				},
				async exec(): Promise<Array<[Error | null, unknown]>> {
					return ops.map((op) => [null, op()]);
				},
			};
			return chain;
		},

		async ping(): Promise<string> {
			return "PONG";
		},

		async quit(): Promise<string> {
			return "OK";
		},

		clear(): void {
			sortedSets.clear();
			strings.clear();
			hashes.clear();
			streams.clear();
			ttls.clear();
			streamSeq = 0;
		},
	};

	return impl;
}

export type MockRedis = ReturnType<typeof createMockRedis>;
