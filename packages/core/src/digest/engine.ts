/**
 * Redis-based digest engine for batching notification events.
 *
 * Groups multiple events of the same type for the same subscriber into
 * a single digest notification, using sorted sets with timestamps.
 *
 * Key pattern: `emito:digest:{subscriberId}:{eventType}`
 *
 * Features:
 * - Threshold-based flush: triggers when maxCount reached
 * - Time-based flush: setInterval poller checks for expired windows
 * - Redis lock: prevents double-flush across multiple instances
 * - Graceful degradation: sends immediately when Redis unavailable
 */

import { randomBytes } from "node:crypto";
import type { Logger } from "../observability/logger";
import type { RedisLike } from "../redis/types";
import { acquireFlushLock, atomicFlush, checkpointKey, digestKey, flushLockKey } from "./flush";

/** A single event stored in the digest buffer. */
export interface DigestEvent {
	/** Subscriber ID. */
	readonly subscriberId: string;
	/** Event type. */
	readonly eventType: string;
	/** The event payload data. */
	readonly payload: Record<string, unknown>;
	/** Unix millisecond timestamp when the event was added. */
	readonly timestamp: number;
}

/** Digest engine configuration. */
export interface DigestEngineConfig {
	/** Maximum events before immediate flush. */
	readonly maxCount: number;
	/** Time window in milliseconds before time-based flush. */
	readonly windowMs: number;
	/** Unique instance identifier for per-instance checkpoint isolation. */
	readonly instanceId?: string;
}

/** Minimal metrics interface for digest engine. */
interface DigestMetrics {
	queueDepth: { set(labels: Record<string, string>, value: number): void };
}

/** Digest engine for batching notification events. */
export interface DigestEngine {
	/**
	 * Add an event to the digest buffer.
	 * Returns true if the digest buffer has reached the maxCount threshold
	 * and an immediate flush is needed.
	 */
	addEvent(event: DigestEvent): Promise<boolean>;

	/**
	 * Flush accumulated events from the digest buffer.
	 * Acquires a Redis lock to prevent double-flush across instances.
	 * Returns all events sorted by timestamp and clears the buffer.
	 */
	flush(subscriberId: string, eventType: string): Promise<readonly DigestEvent[]>;

	/**
	 * Start the time-based flush poller.
	 */
	start(): Promise<void>;

	/**
	 * Stop the time-based flush poller.
	 */
	stop(): Promise<void>;
}

/** Entry tracking an active digest buffer in memory. */
interface TrackedDigest {
	readonly subscriberId: string;
	readonly eventType: string;
	/** Timestamp of the first event added to this buffer. */
	readonly firstEventAt: number;
}

/**
 * Create a Redis-based digest engine for batching notification events.
 *
 * Graceful degradation: if Redis is unavailable (connection error, timeout),
 * addEvent returns false (skip buffering), flush returns [], getCount returns 0.
 */
export function createDigestEngine(deps: {
	readonly redis: RedisLike;
	readonly logger: Logger;
	readonly metrics?: DigestMetrics;
	readonly config: DigestEngineConfig;
	readonly onFlush?: (
		subscriberId: string,
		eventType: string,
		events: DigestEvent[],
	) => Promise<void>;
}): DigestEngine {
	const { redis, logger, metrics, config, onFlush } = deps;

	/**
	 * Track active digest keys in memory since RedisLike lacks SCAN.
	 * Map key is `{subscriberId}:{eventType}`.
	 */
	const activeDigests = new Map<string, TrackedDigest>();

	let pollerInterval: ReturnType<typeof setInterval> | undefined;

	function trackKey(subscriberId: string, eventType: string): void {
		const mapKey = `${subscriberId}:${eventType}`;
		if (!activeDigests.has(mapKey)) {
			activeDigests.set(mapKey, {
				subscriberId,
				eventType,
				firstEventAt: Date.now(),
			});
		}
	}

	function untrackKey(subscriberId: string, eventType: string): void {
		activeDigests.delete(`${subscriberId}:${eventType}`);
	}

	return {
		async addEvent(event: DigestEvent): Promise<boolean> {
			const { subscriberId, eventType, payload } = event;
			try {
				const key = digestKey(subscriberId, eventType);
				const now = Date.now();
				const uniqueId = randomBytes(4).toString("hex");
				const member = JSON.stringify({
					subscriberId,
					eventType,
					payload,
					timestamp: now,
					_id: uniqueId,
				});
				const ttlSeconds = Math.ceil(config.windowMs / 1000) + 60;

				await redis.zadd(key, now, member);
				const count = await redis.zcard(key);
				await redis.expire(key, ttlSeconds);

				trackKey(subscriberId, eventType);

				logger.debug(
					{ subscriberId, eventType, count, maxCount: config.maxCount },
					"added event to digest buffer",
				);

				metrics?.queueDepth.set({ channel: "digest" }, count);

				return count >= config.maxCount;
			} catch (error) {
				/* Graceful degradation: skip buffering, send immediately. */
				logger.warn(
					{ subscriberId, eventType, error: String(error) },
					"digest engine Redis unavailable, skipping buffer",
				);
				return false;
			}
		},

		async flush(subscriberId: string, eventType: string): Promise<readonly DigestEvent[]> {
			try {
				const locked = await acquireFlushLock(redis, subscriberId, eventType);
				if (!locked) {
					logger.debug(
						{ subscriberId, eventType },
						"digest flush lock held by another instance, skipping",
					);
					return [];
				}

				const rawEvents = await atomicFlush(redis, subscriberId, eventType);

				/* Release the lock immediately after flush so subsequent flushes aren't
				   blocked for the full 30s TTL. The lock auto-expires as a safety net. */
				await redis.del(flushLockKey(subscriberId, eventType));

				untrackKey(subscriberId, eventType);

				const events: DigestEvent[] = rawEvents.map((e) => ({
					subscriberId,
					eventType,
					payload: e.payload,
					timestamp: e.timestamp,
				}));

				logger.debug({ subscriberId, eventType, flushed: events.length }, "flushed digest buffer");

				metrics?.queueDepth.set({ channel: "digest" }, 0);

				return events;
			} catch (error) {
				/* Graceful degradation: return empty. */
				logger.warn(
					{ subscriberId, eventType, error: String(error) },
					"digest flush Redis unavailable",
				);
				return [];
			}
		},

		async start(): Promise<void> {
			if (pollerInterval) {
				return;
			}

			logger.info({ intervalMs: config.windowMs }, "starting digest poller");

			// Recovery: read checkpoint first (fast O(1)), then SCAN for orphaned keys
			try {
				const cpKey = checkpointKey(config.instanceId);
				const hashData = await redis.hgetall(cpKey);

				// Restore from checkpoint (hash fields are mapKey, values are firstEventAt as string)
				for (const [mapKey, value] of Object.entries(hashData)) {
					const sep = mapKey.indexOf(":");
					if (sep === -1) continue;
					const subscriberId = mapKey.slice(0, sep);
					const eventType = mapKey.slice(sep + 1);
					activeDigests.set(mapKey, {
						subscriberId,
						eventType,
						firstEventAt: Number(value),
					});
				}

				// SCAN for orphaned digest keys not in checkpoint
				// Use scanAll (cluster-aware) when available, fall back to regular scan
				const scanFn = redis.scanAll?.bind(redis) ?? redis.scan.bind(redis);
				let cursor = "0";
				do {
					const [nextCursor, keys] = await scanFn(cursor, "emito:digest:*", 100);
					cursor = nextCursor;
					for (const key of keys) {
						// Skip flush locks and checkpoint keys (both legacy and per-instance)
						if (key.includes("flush_lock:") || key.includes("_checkpoint")) continue;

						// Extract subscriberId:eventType from key pattern emito:digest:{subscriberId}:{eventType}
						const prefix = "emito:digest:";
						const rest = key.slice(prefix.length);
						const sep = rest.indexOf(":");
						if (sep === -1) continue;
						const subscriberId = rest.slice(0, sep);
						const eventType = rest.slice(sep + 1);
						const mapKey = `${subscriberId}:${eventType}`;

						if (!activeDigests.has(mapKey)) {
							activeDigests.set(mapKey, {
								subscriberId,
								eventType,
								firstEventAt: Date.now(),
							});
							logger.info({ subscriberId, eventType }, "recovered orphaned digest key via SCAN");
						}
					}
				} while (cursor !== "0");

				// Clean up checkpoint after loading
				if (Object.keys(hashData).length > 0) {
					await redis.del(cpKey);
					logger.info({ recoveredCount: activeDigests.size }, "digest recovery complete");
				}
			} catch (error) {
				logger.warn({ error: String(error) }, "digest recovery failed, starting fresh");
			}

			pollerInterval = setInterval(async () => {
				// Write periodic checkpoint of active digests (before flush so crash recovery captures current state)
				try {
					const cpKey = checkpointKey(config.instanceId);
					if (activeDigests.size > 0) {
						const currentHash = await redis.hgetall(cpKey);
						const currentFields = new Set(Object.keys(currentHash));
						const activeFields = new Set<string>();

						const tx = redis.multi();
						for (const [mapKey, tracked] of activeDigests) {
							activeFields.add(mapKey);
							tx.hset(cpKey, mapKey, String(tracked.firstEventAt));
						}

						const staleFields = [...currentFields].filter((f) => !activeFields.has(f));
						if (staleFields.length > 0) {
							tx.hdel(cpKey, ...staleFields);
						}
						await tx.exec();
					} else {
						await redis.del(cpKey);
					}
				} catch (error) {
					logger.warn({ error: String(error) }, "poller: checkpoint write failed");
				}

				const now = Date.now();
				const expired: TrackedDigest[] = [];

				for (const tracked of activeDigests.values()) {
					if (now - tracked.firstEventAt >= config.windowMs) {
						expired.push(tracked);
					}
				}

				for (const { subscriberId, eventType } of expired) {
					try {
						const locked = await acquireFlushLock(redis, subscriberId, eventType);
						if (!locked) {
							// Stale tracking cleanup: if the digest key is gone
							// (another instance already flushed it), remove from activeDigests
							const keyExists = await redis.exists(digestKey(subscriberId, eventType));
							if (keyExists === 0) {
								untrackKey(subscriberId, eventType);
								logger.debug(
									{ subscriberId, eventType },
									"poller: untracked stale digest (key gone, flushed by another instance)",
								);
							} else {
								logger.debug(
									{ subscriberId, eventType },
									"poller: flush lock held by another instance",
								);
							}
							continue;
						}

						const rawEvents = await atomicFlush(redis, subscriberId, eventType);
						await redis.del(flushLockKey(subscriberId, eventType));
						untrackKey(subscriberId, eventType);

						if (rawEvents.length > 0) {
							const events: DigestEvent[] = rawEvents.map((e) => ({
								subscriberId,
								eventType,
								payload: e.payload,
								timestamp: e.timestamp,
							}));

							logger.info(
								{ subscriberId, eventType, flushed: events.length },
								"poller: time-based digest flush",
							);
							metrics?.queueDepth.set({ channel: "digest" }, 0);

							if (onFlush) {
								await onFlush(subscriberId, eventType, events);
							}
						}
					} catch (error) {
						logger.warn(
							{ subscriberId, eventType, error: String(error) },
							"poller: digest flush failed",
						);
					}
				}
			}, config.windowMs);
		},

		async stop(): Promise<void> {
			if (pollerInterval) {
				clearInterval(pollerInterval);
				pollerInterval = undefined;
			}

			// Flush all active digests on shutdown
			const toFlush = [...activeDigests.values()];
			for (const { subscriberId, eventType } of toFlush) {
				try {
					const locked = await acquireFlushLock(redis, subscriberId, eventType);
					if (!locked) {
						logger.debug(
							{ subscriberId, eventType },
							"stop: flush lock held by another instance, skipping",
						);
						continue;
					}

					const rawEvents = await atomicFlush(redis, subscriberId, eventType);
					await redis.del(flushLockKey(subscriberId, eventType));
					untrackKey(subscriberId, eventType);

					if (rawEvents.length > 0) {
						const events: DigestEvent[] = rawEvents.map((e) => ({
							subscriberId,
							eventType,
							payload: e.payload,
							timestamp: e.timestamp,
						}));

						logger.info(
							{ subscriberId, eventType, flushed: events.length },
							"stop: flushing active digest",
						);
						metrics?.queueDepth.set({ channel: "digest" }, 0);

						if (onFlush) {
							await onFlush(subscriberId, eventType, events);
						}
					}
				} catch (error) {
					logger.warn(
						{ subscriberId, eventType, error: String(error) },
						"stop: digest flush failed",
					);
				}
			}

			// Delete checkpoint after clean shutdown
			try {
				await redis.del(checkpointKey(config.instanceId));
			} catch (error) {
				logger.warn({ error: String(error) }, "stop: checkpoint delete failed");
			}

			logger.info("stopped digest poller");
		},
	};
}
