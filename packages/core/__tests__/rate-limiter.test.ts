/**
 * Tests for the sliding window rate limiter (Task 2).
 *
 * Success criteria:
 * - Sliding window counts within time window
 * - Over-limit rejected with rate_limited status
 * - Optimistic add undone when over limit
 * - TTL set on every key
 * - Graceful degradation allows all when Redis unavailable
 * - emito_rate_limit_hits_total metric increments on rejection
 * - Works with mock Redis
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventRegistry } from "../src/event-registry";
import {
	type RateLimitConfig,
	type RateLimitResult,
	type RateLimiter,
	createRateLimiter,
} from "../src/rate-limiter";
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
// Shared mock logger
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

// ---------------------------------------------------------------------------
// Shared mock metrics
// ---------------------------------------------------------------------------

function createMockMetrics() {
	return {
		rateLimitHitsTotal: { inc: vi.fn() },
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RateLimitConfig = { max: 3, windowMs: 60_000 };
const KEY_PREFIX = "emito:rl";

// ---------------------------------------------------------------------------
// Core rate limiter behaviour (unit tests — mock Redis)
// ---------------------------------------------------------------------------

describe("createRateLimiter", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;
	let limiter: RateLimiter;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
		limiter = createRateLimiter({ redis, logger });
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	// -----------------------------------------------------------------------
	// Basic allow / deny
	// -----------------------------------------------------------------------

	describe("sliding window counts", () => {
		it("allows first request and returns remaining = max - 1", async () => {
			const result = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);

			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(2);
		});

		it("decrements remaining on each successive allowed request", async () => {
			const r1 = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			expect(r1.remaining).toBe(2);

			const r2 = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			expect(r2.remaining).toBe(1);

			const r3 = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			expect(r3.remaining).toBe(0);
		});

		it("rejects the (max+1)th request with allowed=false and remaining=0", async () => {
			for (let i = 0; i < DEFAULT_CONFIG.max; i++) {
				await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			}

			const result = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			expect(result.allowed).toBe(false);
			expect(result.remaining).toBe(0);
		});

		it("handles max=1: first allowed, second denied", async () => {
			const cfg: RateLimitConfig = { max: 1, windowMs: 60_000 };

			const r1 = await limiter.checkAndRecord("email", "sub_1", cfg);
			expect(r1.allowed).toBe(true);
			expect(r1.remaining).toBe(0);

			const r2 = await limiter.checkAndRecord("email", "sub_1", cfg);
			expect(r2.allowed).toBe(false);
			expect(r2.remaining).toBe(0);
		});

		it("allows again after window has passed", async () => {
			const cfg: RateLimitConfig = { max: 1, windowMs: 5_000 };

			const r1 = await limiter.checkAndRecord("push", "sub_x", cfg);
			expect(r1.allowed).toBe(true);

			const r2 = await limiter.checkAndRecord("push", "sub_x", cfg);
			expect(r2.allowed).toBe(false);

			vi.advanceTimersByTime(6_000);

			const r3 = await limiter.checkAndRecord("push", "sub_x", cfg);
			expect(r3.allowed).toBe(true);
		});

		it("does not count entries outside the sliding window", async () => {
			// Fill window to capacity
			for (let i = 0; i < DEFAULT_CONFIG.max; i++) {
				await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			}

			// Advance past the window
			vi.advanceTimersByTime(DEFAULT_CONFIG.windowMs + 1_000);

			const result = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(DEFAULT_CONFIG.max - 1);
		});

		it("handles large window (1h) and large max", async () => {
			const cfg: RateLimitConfig = { max: 100, windowMs: 3_600_000 };

			const result = await limiter.checkAndRecord("email", "sub_1", cfg);
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(99);
		});
	});

	// -----------------------------------------------------------------------
	// Key isolation
	// -----------------------------------------------------------------------

	describe("key isolation", () => {
		it("treats different channels as independent limits", async () => {
			// Exhaust email limit
			for (let i = 0; i < DEFAULT_CONFIG.max; i++) {
				await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			}

			// SMS must still be allowed
			const smsResult = await limiter.checkAndRecord("sms", "sub_1", DEFAULT_CONFIG);
			expect(smsResult.allowed).toBe(true);
		});

		it("treats different subscribers as independent limits", async () => {
			// Exhaust limit for sub_1
			for (let i = 0; i < DEFAULT_CONFIG.max; i++) {
				await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			}

			// sub_2 must still be allowed
			const result = await limiter.checkAndRecord("email", "sub_2", DEFAULT_CONFIG);
			expect(result.allowed).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Redis key pattern
	// -----------------------------------------------------------------------

	describe("Redis key pattern", () => {
		it("uses emito:rl:{channel}:{subscriberId} key", async () => {
			await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);

			const count = await redis.zcard(`${KEY_PREFIX}:email:sub_1`);
			expect(count).toBe(1);
		});

		it("uses separate keys for separate channels", async () => {
			await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			await limiter.checkAndRecord("sms", "sub_1", DEFAULT_CONFIG);

			expect(await redis.zcard(`${KEY_PREFIX}:email:sub_1`)).toBe(1);
			expect(await redis.zcard(`${KEY_PREFIX}:sms:sub_1`)).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// Optimistic add / undo
	// -----------------------------------------------------------------------

	describe("optimistic add undo", () => {
		it("removes the optimistically-added entry when over limit", async () => {
			// Reach the limit
			for (let i = 0; i < DEFAULT_CONFIG.max; i++) {
				await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			}

			// Attempt one more — should be denied
			const denied = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			expect(denied.allowed).toBe(false);

			// Sorted set must still only contain max entries (the undo removed it)
			const count = await redis.zcard(`${KEY_PREFIX}:email:sub_1`);
			expect(count).toBe(DEFAULT_CONFIG.max);
		});

		it("sorted set count equals successful requests only", async () => {
			// 3 allowed + 2 denied
			for (let i = 0; i < DEFAULT_CONFIG.max; i++) {
				await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			}
			await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);

			const count = await redis.zcard(`${KEY_PREFIX}:email:sub_1`);
			expect(count).toBe(DEFAULT_CONFIG.max);
		});
	});

	// -----------------------------------------------------------------------
	// TTL
	// -----------------------------------------------------------------------

	describe("TTL", () => {
		it("sets TTL on the key after every allowed request", async () => {
			await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);

			// Verify the key expires after windowMs + 60s by advancing time
			const ttlMs = (Math.ceil(DEFAULT_CONFIG.windowMs / 1000) + 60) * 1000;
			vi.advanceTimersByTime(ttlMs + 1000);

			const count = await redis.zcard(`${KEY_PREFIX}:email:sub_1`);
			expect(count).toBe(0);
		});

		it("sets TTL when request is denied (via MULTI before the ZREM undo)", async () => {
			// Fill to limit — TTL must be set during the multi exec
			for (let i = 0; i < DEFAULT_CONFIG.max; i++) {
				await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			}

			// Deny request — TTL was set inside the atomic MULTI block
			const denied = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			expect(denied.allowed).toBe(false);

			// The key should still expire after the TTL
			const ttlMs = (Math.ceil(DEFAULT_CONFIG.windowMs / 1000) + 60) * 1000;
			vi.advanceTimersByTime(ttlMs + 1000);
			const count = await redis.zcard(`${KEY_PREFIX}:email:sub_1`);
			expect(count).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// resetMs
	// -----------------------------------------------------------------------

	describe("resetMs", () => {
		it("returns a positive resetMs on allowed requests", async () => {
			const result = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			expect(result.resetMs).toBeGreaterThan(0);
			expect(result.resetMs).toBeLessThanOrEqual(DEFAULT_CONFIG.windowMs);
		});

		it("returns a positive resetMs on denied requests", async () => {
			for (let i = 0; i < DEFAULT_CONFIG.max; i++) {
				await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			}
			const denied = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
			expect(denied.resetMs).toBeGreaterThan(0);
			expect(denied.resetMs).toBeLessThanOrEqual(DEFAULT_CONFIG.windowMs);
		});
	});
});

// ---------------------------------------------------------------------------
// Metric: emito_rate_limit_hits_total
// ---------------------------------------------------------------------------

describe("emito_rate_limit_hits_total metric", () => {
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

	it("increments emito_rate_limit_hits_total when a request is denied", async () => {
		const metrics = createMockMetrics();
		const limiter = createRateLimiter({ redis, logger, metrics: metrics as any });

		const cfg: RateLimitConfig = { max: 1, windowMs: 60_000 };

		await limiter.checkAndRecord("email", "sub_1", cfg); // allowed — no increment
		await limiter.checkAndRecord("email", "sub_1", cfg); // denied — increment

		expect(metrics.rateLimitHitsTotal.inc).toHaveBeenCalledTimes(1);
		expect(metrics.rateLimitHitsTotal.inc).toHaveBeenCalledWith(
			expect.objectContaining({ channel: "email" }),
		);
	});

	it("does not increment metric on allowed requests", async () => {
		const metrics = createMockMetrics();
		const limiter = createRateLimiter({ redis, logger, metrics: metrics as any });

		const cfg: RateLimitConfig = { max: 5, windowMs: 60_000 };
		await limiter.checkAndRecord("email", "sub_1", cfg);
		await limiter.checkAndRecord("email", "sub_1", cfg);

		expect(metrics.rateLimitHitsTotal.inc).not.toHaveBeenCalled();
	});

	it("increments once per denied request even with multiple denials", async () => {
		const metrics = createMockMetrics();
		const limiter = createRateLimiter({ redis, logger, metrics: metrics as any });

		const cfg: RateLimitConfig = { max: 1, windowMs: 60_000 };

		await limiter.checkAndRecord("sms", "sub_1", cfg); // allowed
		await limiter.checkAndRecord("sms", "sub_1", cfg); // denied
		await limiter.checkAndRecord("sms", "sub_1", cfg); // denied

		expect(metrics.rateLimitHitsTotal.inc).toHaveBeenCalledTimes(2);
	});

	it("works without metrics configured (no throw)", async () => {
		const limiter = createRateLimiter({ redis, logger }); // no metrics

		const cfg: RateLimitConfig = { max: 1, windowMs: 60_000 };
		await limiter.checkAndRecord("email", "sub_1", cfg);
		// Should not throw
		await expect(limiter.checkAndRecord("email", "sub_1", cfg)).resolves.toMatchObject({
			allowed: false,
		});
	});
});

// ---------------------------------------------------------------------------
// Graceful degradation — Redis unavailable
// ---------------------------------------------------------------------------

describe("graceful degradation when Redis is unavailable", () => {
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function makeFailingRedis(): MockRedis {
		const r = createMockRedis();
		vi.spyOn(r, "multi").mockImplementation(() => {
			throw new Error("ECONNREFUSED");
		});
		return r;
	}

	it("allows the request through when Redis multi() throws", async () => {
		const redis = makeFailingRedis();
		const limiter = createRateLimiter({ redis, logger });

		const result = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
		expect(result.allowed).toBe(true);
	});

	it("logs a warn when Redis is unavailable", async () => {
		const redis = makeFailingRedis();
		const limiter = createRateLimiter({ redis, logger });

		await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);

		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.any(String) }),
			expect.stringContaining("rate limiter"),
		);
	});

	it("allows all requests when Redis exec() rejects", async () => {
		const r = createMockRedis();
		const failChain = {
			zremrangebyscore: () => failChain,
			zadd: () => failChain,
			zcard: () => failChain,
			expire: () => failChain,
			exec: async () => {
				throw new Error("READONLY");
			},
		};
		vi.spyOn(r, "multi").mockReturnValue(failChain as any);

		const limiter = createRateLimiter({ redis: r, logger });

		const r1 = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
		expect(r1.allowed).toBe(true);

		const r2 = await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
		expect(r2.allowed).toBe(true);
	});

	it("does not increment the metric when Redis is unavailable", async () => {
		const metrics = createMockMetrics();
		const redis = makeFailingRedis();
		const limiter = createRateLimiter({ redis, logger, metrics: metrics as any });

		await limiter.checkAndRecord("email", "sub_1", DEFAULT_CONFIG);
		expect(metrics.rateLimitHitsTotal.inc).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// send.ts integration: rate_limited ChannelResult status
// ---------------------------------------------------------------------------

describe("executeSend with rate limiter returning allowed=false", () => {
	it("returns rate_limited ChannelResult when rate limiter denies the channel", async () => {
		const subscriberRepo = new InMemorySubscriberRepository();
		subscriberRepo.seed({
			id: "sub_rl",
			email: "rl@example.com",
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
			"user.welcome": { category: "transactional", channels: ["email"] },
		});

		// Rate limiter that always denies
		const denyingRateLimiter: RateLimiter = {
			async checkAndRecord(_channel, _subscriberId, _config) {
				return { allowed: false, remaining: 0, resetMs: 60_000 };
			},
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
			rateLimiter: denyingRateLimiter,
			rateLimitConfigs: { email: { max: 1, windowMs: 60_000 } },
		};

		const result = await executeSend(
			{ subscriberId: "sub_rl", event: "user.welcome", payload: {} },
			deps,
		);

		const emailResult = result.channels.find((c) => c.channel === "email");
		expect(emailResult).toMatchObject({ channel: "email", status: "rate_limited" });
	});
});
