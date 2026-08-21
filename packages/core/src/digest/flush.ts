/**
 * Atomic flush and lock coordination for the digest engine.
 *
 * Flush: MULTI(ZRANGEBYSCORE + DEL) reads all buffered events and deletes
 * the key in one transaction, preventing event loss.
 *
 * Lock: SET NX EX 30 ensures only one instance flushes a given
 * subscriber+eventType at a time across multiple instances.
 */

import type { RedisLike } from "../redis/types";

/** A single event stored in the digest buffer. */
export interface DigestEvent {
	/** The event payload data. */
	readonly payload: Record<string, unknown>;
	/** Unix millisecond timestamp when the event was added. */
	readonly timestamp: number;
}

/**
 * Build the Redis key for a digest buffer.
 */
export function digestKey(subscriberId: string, eventType: string): string {
	return `emito:digest:${subscriberId}:${eventType}`;
}

/**
 * Build the Redis key for a digest flush lock.
 */
export function flushLockKey(subscriberId: string, eventType: string): string {
	return `emito:digest:flush_lock:${subscriberId}:${eventType}`;
}

/**
 * Build the Redis key for the digest checkpoint hash.
 * When instanceId is provided, creates a per-instance checkpoint key
 * to prevent checkpoint collision across multiple Emito instances.
 */
export function checkpointKey(instanceId?: string): string {
	if (instanceId) {
		return `emito:digest:_checkpoint:${instanceId}`;
	}
	return "emito:digest:_checkpoint";
}

/** Lock TTL in seconds — safety net if instance dies mid-flush. */
const FLUSH_LOCK_TTL_SECONDS = 30;

/**
 * Acquire a flush lock for a subscriber+eventType pair.
 * Uses SET NX EX to ensure only one instance flushes at a time.
 *
 * @returns true if the lock was acquired, false if another instance holds it.
 */
export async function acquireFlushLock(
	redis: RedisLike,
	subscriberId: string,
	eventType: string,
): Promise<boolean> {
	const key = flushLockKey(subscriberId, eventType);
	const result = await redis.set(key, "1", "NX", "EX", FLUSH_LOCK_TTL_SECONDS);
	return result === "OK";
}

/**
 * Atomically read all buffered events and delete the key.
 * Uses MULTI(ZRANGEBYSCORE + DEL) to prevent losing events
 * added between read and delete.
 *
 * @returns Parsed digest events sorted by timestamp.
 */
export async function atomicFlush(
	redis: RedisLike,
	subscriberId: string,
	eventType: string,
): Promise<readonly DigestEvent[]> {
	const key = digestKey(subscriberId, eventType);

	const results = await redis.multi().zrangebyscore(key, "-inf", "+inf").del(key).exec();

	/* results[0] is the ZRANGEBYSCORE result: [error, members]. */
	const zrangeResult = results[0];
	const members = (zrangeResult ? zrangeResult[1] : []) as string[];

	if (members.length === 0) {
		return [];
	}

	const events: DigestEvent[] = members.map((raw) => {
		const parsed = JSON.parse(raw) as { payload: Record<string, unknown>; timestamp: number };
		return { payload: parsed.payload, timestamp: parsed.timestamp };
	});

	events.sort((a, b) => a.timestamp - b.timestamp);

	return events;
}
