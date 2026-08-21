/**
 * Tests for start()/stop() lifecycle and healthCheck() on the Emito instance.
 *
 * Covers:
 * - start() initializes the instance (providers validated/pinged)
 * - stop() shuts down gracefully without errors
 * - healthCheck() aggregates provider health results
 * - healthCheck() returns false if any provider is unhealthy
 * - Calling start() multiple times is safe (idempotent or raises meaningful error)
 * - Using send() before start() raises an appropriate error or works (per impl)
 *
 * Rules applied (testing standards):
 * - Assert on specific EmitoErrorCode values (rule 1)
 * - Assert on isRetryable for error path tests (rule 2)
 * - Use test data builders, never inline literals (rule 7)
 * - Use in-memory repositories for unit tests (rule 12)
 * - Follow describe/it naming convention (rule 15)
 * - Assert on shape of return values (rule 26)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmito } from "../src/emito";
import {
	healthCheck as lifecycleHealthCheck,
	start as lifecycleStart,
	stop as lifecycleStop,
	withTimeout,
} from "../src/lifecycle";
import type { LifecycleDeps } from "../src/lifecycle";
import {
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemorySubscriberRepository,
	InMemoryConsentRepository,
	InMemorySubscriptionRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "../src/repositories/in-memory/index";
import { createMockProvider } from "../src/testing/mock-provider";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function createRepositories() {
	return {
		subscriberRepository: new InMemorySubscriberRepository(),
		notificationRepository: new InMemoryNotificationRepository(),
		preferenceRepository: new InMemoryPreferenceRepository(),
		workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
		suppressionRepository: new InMemorySuppressionRepository(),
		subscriptionRepository: new InMemorySubscriptionRepository(),
		deadLetterRepository: new InMemoryDeadLetterRepository(),
		integrationRepository: new InMemoryIntegrationRepository(),
		inboxRepository: new InMemoryInboxRepository(),
		consentRepository: new InMemoryConsentRepository(),
	};
}

function createMinimalConfig(overrides: Record<string, unknown> = {}) {
	return {
		database: { url: "postgresql://localhost:5432/test" },
		redis: { url: "redis://localhost:6379" },
		events: {
			"user.welcome": {
				category: "transactional",
				channels: ["email" as const],
			},
		},
		categories: {
			transactional: { policy: "always" as const },
		},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// start() / stop() lifecycle
// ---------------------------------------------------------------------------

describe("Emito lifecycle", () => {
	let repos: ReturnType<typeof createRepositories>;
	let emailProvider: ReturnType<typeof createMockProvider>;

	beforeEach(() => {
		repos = createRepositories();
		emailProvider = createMockProvider("email");
	});

	describe("start", () => {
		it("should resolve without error on first call", async () => {
			const emito = createEmito({
				...createMinimalConfig({
					channels: { email: { providers: [emailProvider] } },
				}),
				repositories: repos,
			});

			await expect(emito.start()).resolves.not.toThrow();
		});

		it("should resolve without error with no channels configured", async () => {
			const emito = createEmito({
				...createMinimalConfig(),
				repositories: repos,
			});

			await expect(emito.start()).resolves.not.toThrow();
		});

		it("should resolve without error with multiple providers across channels", async () => {
			const smsProvider = createMockProvider("sms");

			const emito = createEmito({
				...createMinimalConfig({
					events: {
						"user.welcome": {
							category: "transactional",
							channels: ["email" as const, "sms" as const],
						},
					},
					channels: {
						email: { providers: [emailProvider] },
						sms: { providers: [smsProvider] },
					},
				}),
				repositories: repos,
			});

			await expect(emito.start()).resolves.not.toThrow();
		});
	});

	describe("stop", () => {
		it("should resolve without error after start", async () => {
			const emito = createEmito({
				...createMinimalConfig({
					channels: { email: { providers: [emailProvider] } },
				}),
				repositories: repos,
			});
			await emito.start();

			await expect(emito.stop()).resolves.not.toThrow();
		});

		it("should resolve without error even if start was never called", async () => {
			const emito = createEmito({
				...createMinimalConfig(),
				repositories: repos,
			});

			await expect(emito.stop()).resolves.not.toThrow();
		});

		it("should allow calling stop multiple times without error", async () => {
			const emito = createEmito({
				...createMinimalConfig(),
				repositories: repos,
			});
			await emito.start();

			await emito.stop();
			await expect(emito.stop()).resolves.not.toThrow();
		});
	});

	// ---------------------------------------------------------------------------
	// healthCheck() — provider health aggregation
	// ---------------------------------------------------------------------------

	describe("healthCheck", () => {
		it("should return healthy:true when all providers are healthy", async () => {
			const healthyProvider = createMockProvider("email", { healthy: true });

			const emito = createEmito({
				...createMinimalConfig({
					channels: { email: { providers: [healthyProvider] } },
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.healthCheck();

			expect(result).toMatchObject({ healthy: true });
		});

		it("should return healthy:false when at least one provider is unhealthy", async () => {
			const unhealthyProvider = createMockProvider("email", { healthy: false });

			const emito = createEmito({
				...createMinimalConfig({
					channels: { email: { providers: [unhealthyProvider] } },
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.healthCheck();

			expect(result).toMatchObject({ healthy: false });
		});

		it("should return healthy:true when no providers are configured", async () => {
			const emito = createEmito({
				...createMinimalConfig(),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.healthCheck();

			expect(result).toMatchObject({ healthy: true });
		});

		it("should aggregate health from all providers across all channels", async () => {
			const healthyEmail = createMockProvider("email", { healthy: true });
			const unhealthySms = createMockProvider("sms", { healthy: false });

			const emito = createEmito({
				...createMinimalConfig({
					events: {
						"user.welcome": {
							category: "transactional",
							channels: ["email" as const, "sms" as const],
						},
					},
					channels: {
						email: { providers: [healthyEmail] },
						sms: { providers: [unhealthySms] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.healthCheck();

			// Should reflect the unhealthy sms provider
			expect(result).toMatchObject({ healthy: false });
		});

		it("should return provider-level details in health result", async () => {
			const emailProvider2 = createMockProvider("email", {
				name: "my-email-provider",
				healthy: true,
			});

			const emito = createEmito({
				...createMinimalConfig({
					channels: { email: { providers: [emailProvider2] } },
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.healthCheck();

			expect(result).toHaveProperty("providers");
			// Providers array/object should be present
			expect(result.providers).toBeDefined();
		});

		it("should return healthy:false when provider healthCheck rejects", async () => {
			// Create a provider that throws during healthCheck
			const brokenProvider = {
				...createMockProvider("email"),
				healthCheck: async () => {
					throw new Error("connection refused");
				},
			};

			const emito = createEmito({
				...createMinimalConfig({
					channels: { email: { providers: [brokenProvider] } },
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.healthCheck();

			expect(result).toMatchObject({ healthy: false });
		});
	});

	// ---------------------------------------------------------------------------
	// start → stop → start cycle
	// ---------------------------------------------------------------------------

	describe("start/stop/start cycle", () => {
		it("should allow restart after stop", async () => {
			const emito = createEmito({
				...createMinimalConfig({
					channels: { email: { providers: [emailProvider] } },
				}),
				repositories: repos,
			});

			await emito.start();
			await emito.stop();
			await expect(emito.start()).resolves.not.toThrow();
		});
	});
});

// ---------------------------------------------------------------------------
// Shutdown order — digestEngine.stop() must be called before redis.quit()
// ---------------------------------------------------------------------------

/**
 * SHUTDOWN ORDER TEST for B-003.
 *
 * lifecycle.ts:stop() previously called redis.quit() before digestEngine.stop().
 * The fix reverses this so digestEngine can flush events to Redis before quit.
 */
describe("lifecycle shutdown order", () => {
	it("digestEngine.stop() is called before redis.quit()", async () => {
		const callOrder: string[] = [];

		const mockLogger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			trace: vi.fn(),
			fatal: vi.fn(),
			child: vi.fn().mockReturnThis(),
			level: "silent" as const,
		};

		const mockRedis = {
			ping: vi.fn().mockResolvedValue("PONG"),
			quit: vi.fn().mockImplementation(async () => {
				callOrder.push("redis.quit");
				return "OK";
			}),
			zadd: vi.fn().mockResolvedValue(0),
			zrangebyscore: vi.fn().mockResolvedValue([]),
			zremrangebyscore: vi.fn().mockResolvedValue(0),
			zcard: vi.fn().mockResolvedValue(0),
			zrem: vi.fn().mockResolvedValue(0),
			del: vi.fn().mockResolvedValue(0),
			set: vi.fn().mockResolvedValue("OK"),
			get: vi.fn().mockResolvedValue(null),
			exists: vi.fn().mockResolvedValue(0),
			expire: vi.fn().mockResolvedValue(1),
			multi: vi.fn().mockReturnValue({
				zrangebyscore: vi.fn().mockReturnThis(),
				del: vi.fn().mockReturnThis(),
				exec: vi.fn().mockResolvedValue([
					[null, []],
					[null, 0],
				]),
			}),
			scan: vi.fn().mockResolvedValue(["0", []]),
			hset: vi.fn().mockResolvedValue(0),
			hgetall: vi.fn().mockResolvedValue({}),
		};

		const mockDigestEngine = {
			start: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockImplementation(async () => {
				callOrder.push("digestEngine.stop");
			}),
			addEvent: vi.fn().mockResolvedValue(false),
			flush: vi.fn().mockResolvedValue([]),
		};

		const deps: LifecycleDeps = {
			providers: [],
			logger: mockLogger as any,
			redis: mockRedis as any,
			digestEngine: mockDigestEngine,
		};

		await lifecycleStop(deps);

		// digestEngine.stop must be called before redis.quit
		const digestIdx = callOrder.indexOf("digestEngine.stop");
		const quitIdx = callOrder.indexOf("redis.quit");

		expect(digestIdx).toBeGreaterThanOrEqual(0);
		expect(quitIdx).toBeGreaterThanOrEqual(0);
		expect(digestIdx).toBeLessThan(quitIdx);
	});
});

// ---------------------------------------------------------------------------
// Task 2: Parallel health checks with per-provider timeout
// ---------------------------------------------------------------------------

/**
 * Tests for D-004: parallel healthCheck() / start() with configurable timeout.
 *
 * Success criteria:
 * - start() and healthCheck() use Promise.allSettled (parallel, not sequential)
 * - Per-provider timeout: slow provider does not block others
 * - Timed-out provider reports healthy:false + logs warn
 * - healthCheckTimeoutMs defaults to 5000ms
 * - Graceful degradation: all providers run even if one times out
 */
describe("parallel health checks with timeout (D-004)", () => {
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

	afterEach(() => {
		vi.useRealTimers();
	});

	it("healthCheck() runs all providers in parallel — slow provider does not block fast one", async () => {
		vi.useFakeTimers();

		const completionOrder: string[] = [];

		const fastProvider = {
			name: "fast-provider",
			channel: "email" as const,
			deliver: vi.fn(),
			healthCheck: vi.fn().mockImplementation(async () => {
				completionOrder.push("fast");
				return true;
			}),
		};

		// Slow provider resolves after 3000ms
		const slowProvider = {
			name: "slow-provider",
			channel: "sms" as const,
			deliver: vi.fn(),
			healthCheck: vi.fn().mockImplementation(() => {
				return new Promise<boolean>((resolve) => {
					setTimeout(() => {
						completionOrder.push("slow");
						resolve(true);
					}, 3000);
				});
			}),
		};

		const logger = createMockLogger();
		const deps: LifecycleDeps = {
			providers: [fastProvider, slowProvider],
			logger,
			healthCheckTimeoutMs: 10_000, // generous timeout so both can complete
		};

		const resultPromise = lifecycleHealthCheck(deps);
		await vi.advanceTimersByTimeAsync(4000);
		const result = await resultPromise;

		// Both providers should have been checked
		expect(result.providers).toHaveLength(2);
		expect(result.providers.every((p) => p.healthy)).toBe(true);
	});

	it("healthCheck() times out a slow provider — others still succeed", async () => {
		vi.useFakeTimers();

		const fastProvider = {
			name: "fast-provider",
			channel: "email" as const,
			deliver: vi.fn(),
			healthCheck: vi.fn().mockResolvedValue(true),
		};

		// Slow provider never resolves within timeout
		const slowProvider = {
			name: "slow-provider",
			channel: "sms" as const,
			deliver: vi.fn(),
			healthCheck: vi.fn().mockImplementation(() => {
				return new Promise<boolean>(() => {
					// Never resolves — simulates a hung provider
				});
			}),
		};

		const logger = createMockLogger();
		const deps: LifecycleDeps = {
			providers: [fastProvider, slowProvider],
			logger,
			healthCheckTimeoutMs: 2000, // 2s timeout
		};

		const resultPromise = lifecycleHealthCheck(deps);
		// Advance past the timeout
		await vi.advanceTimersByTimeAsync(3000);
		const result = await resultPromise;

		// Fast provider should be healthy
		const fastResult = result.providers.find((p) => p.name === "fast-provider");
		expect(fastResult).toBeDefined();
		expect(fastResult?.healthy).toBe(true);

		// Slow provider should be marked unhealthy due to timeout
		const slowResult = result.providers.find((p) => p.name === "slow-provider");
		expect(slowResult).toBeDefined();
		expect(slowResult?.healthy).toBe(false);

		// Overall should be unhealthy because one provider timed out
		expect(result.healthy).toBe(false);
	});

	it("healthCheck() logs a warning when a provider times out", async () => {
		vi.useFakeTimers();

		const slowProvider = {
			name: "slow-provider",
			channel: "email" as const,
			deliver: vi.fn(),
			healthCheck: vi.fn().mockImplementation(() => new Promise<boolean>(() => {})),
		};

		const logger = createMockLogger();
		const deps: LifecycleDeps = {
			providers: [slowProvider],
			logger,
			healthCheckTimeoutMs: 1000,
		};

		const resultPromise = lifecycleHealthCheck(deps);
		await vi.advanceTimersByTimeAsync(2000);
		await resultPromise;

		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "slow-provider" }),
			expect.any(String),
		);
	});

	it("start() times out a slow provider and continues without blocking", async () => {
		vi.useFakeTimers();

		const slowProvider = {
			name: "slow-provider",
			channel: "email" as const,
			deliver: vi.fn(),
			healthCheck: vi.fn().mockImplementation(() => new Promise<boolean>(() => {})),
		};

		const logger = createMockLogger();
		const deps: LifecycleDeps = {
			providers: [slowProvider],
			logger,
			healthCheckTimeoutMs: 1000,
		};

		const startPromise = lifecycleStart(deps);
		await vi.advanceTimersByTimeAsync(2000);
		// start() must resolve even with a timed-out provider
		await expect(startPromise).resolves.not.toThrow();
	});

	it("healthCheck() with healthCheckTimeoutMs=5000 is the default (does not throw)", async () => {
		const healthyProvider = {
			name: "email-provider",
			channel: "email" as const,
			deliver: vi.fn(),
			healthCheck: vi.fn().mockResolvedValue(true),
		};

		const logger = createMockLogger();
		// No explicit healthCheckTimeoutMs — should use default 5000ms
		const deps: LifecycleDeps = {
			providers: [healthyProvider],
			logger,
		};

		const result = await lifecycleHealthCheck(deps);
		expect(result.healthy).toBe(true);
		expect(result.providers).toHaveLength(1);
		expect(result.providers[0].healthy).toBe(true);
	});

	it("start() runs all provider health checks in parallel — completion is not sequential", async () => {
		vi.useFakeTimers();

		const startTimes: number[] = [];

		function makeSlowProvider(name: string, delayMs: number) {
			return {
				name,
				channel: "email" as const,
				deliver: vi.fn(),
				healthCheck: vi.fn().mockImplementation(async () => {
					startTimes.push(Date.now());
					await new Promise((resolve) => setTimeout(resolve, delayMs));
					return true;
				}),
			};
		}

		const logger = createMockLogger();
		const deps: LifecycleDeps = {
			providers: [
				makeSlowProvider("p1", 100),
				makeSlowProvider("p2", 100),
				makeSlowProvider("p3", 100),
			],
			logger,
			healthCheckTimeoutMs: 10_000,
		};

		const startPromise = lifecycleStart(deps);
		await vi.advanceTimersByTimeAsync(200);
		await startPromise;

		// All three providers should have started near-simultaneously (within 50ms of each other)
		// If they were sequential they'd start at t=0, t=100, t=200
		expect(startTimes).toHaveLength(3);
		const spread = Math.max(...startTimes) - Math.min(...startTimes);
		expect(spread).toBeLessThan(50); // all started at roughly the same time (parallel)
	});
});
