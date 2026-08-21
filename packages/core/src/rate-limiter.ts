/**
 * Redis sliding window rate limiter for notification delivery channels.
 * Uses sorted sets with timestamps as scores to maintain a per-channel,
 * per-subscriber sliding window of delivery attempts.
 *
 * Key pattern: `emito:rl:{channel}:{subscriberId}`
 *
 * Algorithm (add-first, atomic via MULTI):
 * 1. ZREMRANGEBYSCORE — remove entries outside the window
 * 2. ZADD — add the new entry optimistically
 * 3. ZCARD — count entries (including the one just added)
 * 4. EXPIRE — set TTL to prevent orphan keys
 * All four commands execute atomically in a single MULTI/EXEC.
 * If ZCARD > max, the just-added entry is removed via ZREM.
 */

import { randomBytes } from "node:crypto";
import type { RateLimitConfig } from "@emito/types";
import type { Logger } from "./observability/logger";
import type { RedisLike } from "./redis/types";

export type { RateLimitConfig } from "@emito/types";

/** Result of a rate limit check. */
export interface RateLimitResult {
	/** Whether the delivery is allowed. */
	readonly allowed: boolean;
	/** Number of remaining deliveries allowed in the current window. */
	readonly remaining: number;
	/** Milliseconds until the window resets (earliest entry expires). */
	readonly resetMs: number;
}

/** Minimal metrics interface for rate limiter. */
interface RateLimiterMetrics {
	rateLimitHitsTotal: { inc(labels: Record<string, string>): void };
}

/** Rate limiter for notification delivery channels. */
export interface RateLimiter {
	/**
	 * Check if a delivery is allowed and record it if so.
	 * Uses an atomic add-first approach via Redis MULTI/EXEC to avoid TOCTOU races.
	 * If the limit is exceeded, the optimistically-added entry is removed.
	 */
	checkAndRecord(
		channel: string,
		subscriberId: string,
		config: RateLimitConfig,
	): Promise<RateLimitResult>;
}

/**
 * Default rate limit configurations per channel.
 * From architecture: email 20/hr, sms 5/hr, push 30/hr, inApp 100/hr,
 * webhook 1000/min, slack 60/min, telegram 20/min.
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
	email: { max: 20, windowMs: 60 * 60 * 1000 },
	sms: { max: 5, windowMs: 60 * 60 * 1000 },
	push: { max: 30, windowMs: 60 * 60 * 1000 },
	inApp: { max: 100, windowMs: 60 * 60 * 1000 },
	webhook: { max: 1000, windowMs: 60 * 1000 },
	slack: { max: 60, windowMs: 60 * 1000 },
	telegram: { max: 20, windowMs: 60 * 1000 },
};

/**
 * Create a Redis sliding window rate limiter for notification delivery.
 *
 * Graceful degradation: if Redis is unavailable (connection error, timeout),
 * allows the request through and logs at warn level.
 */
export function createRateLimiter(deps: {
	readonly redis: RedisLike;
	readonly logger: Logger;
	readonly metrics?: RateLimiterMetrics;
}): RateLimiter {
	const { redis, logger, metrics } = deps;

	return {
		async checkAndRecord(
			channel: string,
			subscriberId: string,
			config: RateLimitConfig,
		): Promise<RateLimitResult> {
			const key = `emito:rl:${channel}:${subscriberId}`;
			const now = Date.now();
			const windowStart = now - config.windowMs;
			const ttlSeconds = Math.ceil(config.windowMs / 1000) + 60;

			/* Unique member to prevent sorted set deduplication. */
			const uniqueId = `${now}:${randomBytes(4).toString("hex")}`;

			try {
				/* Atomic pipeline: clean, add, count, set TTL — all in one MULTI. */
				const results = await redis
					.multi()
					.zremrangebyscore(key, 0, windowStart)
					.zadd(key, now, uniqueId)
					.zcard(key)
					.expire(key, ttlSeconds)
					.exec();

				/* results[2] is the ZCARD result: [error, count]. */
				const zcardResult = results[2];
				const count = (zcardResult ? zcardResult[1] : 0) as number;

				if (count > config.max) {
					/* Over limit — remove the optimistically-added entry. */
					await redis.zrem(key, uniqueId);
					logger.warn({ channel, subscriberId, count, max: config.max }, "rate limit reached");
					metrics?.rateLimitHitsTotal.inc({ channel });
					return {
						allowed: false,
						remaining: 0,
						resetMs: config.windowMs,
					};
				}

				const remaining = config.max - count;

				logger.debug(
					{ channel, subscriberId, remaining, max: config.max },
					"rate limit check passed",
				);

				return {
					allowed: true,
					remaining,
					resetMs: config.windowMs,
				};
			} catch (error) {
				/* Graceful degradation: allow request through when Redis is unavailable. */
				logger.warn(
					{ channel, subscriberId, error: String(error) },
					"rate limiter Redis unavailable, allowing request",
				);
				return {
					allowed: true,
					remaining: config.max,
					resetMs: config.windowMs,
				};
			}
		},
	};
}
