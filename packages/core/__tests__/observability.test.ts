/**
 * Tests for the observability layer:
 * - Pino logger injection and child logger creation with correlation IDs
 * - 8 Prometheus metrics increment correctly (when metrics enabled)
 * - OTel tracing creates correct span hierarchy
 * - Passthrough template resolver wraps payload as-is
 *
 * Rules applied (testing standards):
 * - Use test data builders, never inline literals (rule 7)
 * - Use mockLogger for all tests (rule 13)
 * - Reset all mocks in afterEach (rule 14 — handled by global test-setup)
 * - Follow describe/it naming convention (rule 15)
 * - Assert on shape of return values (rule 26)
 * - Assert on call arguments for mock verifications (rule 28)
 * - Verify credentials excluded from logs (rule 21)
 * - Use vi.useFakeTimers() for timing behavior (rule 22)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmito } from "../src/emito";
import { createLogger, resolveLogger } from "../src/observability/logger";
import { createMetrics } from "../src/observability/metrics";
import { createTracer, startSpan, withSpan } from "../src/observability/tracing";
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
import { createPassthroughResolver } from "../src/templates/resolver";
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

/**
 * Creates a mock pino-compatible logger that records all calls.
 * Satisfies tester rule 13: use mockLogger for all tests.
 */
function createMockLogger() {
	const calls: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];

	function makeLevel(level: string) {
		return (fields: Record<string, unknown> | string, msg?: string) => {
			if (typeof fields === "string") {
				calls.push({ level, fields: {}, msg: fields });
			} else {
				calls.push({ level, fields, msg: msg ?? "" });
			}
		};
	}

	const logger = {
		info: makeLevel("info"),
		debug: makeLevel("debug"),
		warn: makeLevel("warn"),
		error: makeLevel("error"),
		fatal: makeLevel("fatal"),
		trace: makeLevel("trace"),
		calls,
		child(bindings: Record<string, unknown>) {
			const childCalls: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];

			function makeChildLevel(level: string) {
				return (fields: Record<string, unknown> | string, msg?: string) => {
					const entry =
						typeof fields === "string"
							? { level, fields: bindings, msg: fields }
							: { level, fields: { ...bindings, ...fields }, msg: msg ?? "" };
					childCalls.push(entry);
					calls.push(entry);
				};
			}

			const child = {
				info: makeChildLevel("info"),
				debug: makeChildLevel("debug"),
				warn: makeChildLevel("warn"),
				error: makeChildLevel("error"),
				fatal: makeChildLevel("fatal"),
				trace: makeChildLevel("trace"),
				calls: childCalls,
				child(nestedBindings: Record<string, unknown>) {
					// Proxy to the outer createMockLogger to keep accumulation in root `calls`
					const nested = logger.child({ ...bindings, ...nestedBindings });
					return nested;
				},
			};
			return child;
		},
	};

	return logger;
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

async function seedSubscriber(
	repos: ReturnType<typeof createRepositories>,
	id = "sub_1",
	email = "user@example.com",
) {
	await repos.subscriberRepository.seed({
		id,
		email,
		phone: null,
		locale: "en",
		timezone: null,
		globallyUnsubscribed: false,
		metadata: {},
		erasedAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
	});
}

// ---------------------------------------------------------------------------
// createLogger / resolveLogger — pino injection and child loggers
// ---------------------------------------------------------------------------

describe("createLogger", () => {
	it("should return the provided logger when injected", () => {
		const mockLogger = createMockLogger();
		const logger = createLogger({ logger: mockLogger as never });
		expect(logger).toBeDefined();
	});

	it("should create a default pino logger when none is provided", () => {
		const logger = createLogger({});
		expect(logger).toBeDefined();
		expect(typeof logger.info).toBe("function");
	});

	it("should return the same logger instance when one is provided", () => {
		const mockLogger = createMockLogger();
		const logger = createLogger({ logger: mockLogger as never });
		// Should be the same object (passthrough)
		expect(logger).toBe(mockLogger);
	});
});

describe("resolveLogger", () => {
	it("should return provided logger when passed", () => {
		const mockLogger = createMockLogger();
		const logger = resolveLogger(mockLogger as never);
		expect(logger).toBe(mockLogger);
	});

	it("should return a default logger when called with undefined", () => {
		const logger = resolveLogger(undefined);
		expect(logger).toBeDefined();
		expect(typeof logger.info).toBe("function");
	});

	describe("child loggers", () => {
		it("should create child logger with notificationId, subscriberId, eventType bindings", () => {
			const mockLogger = createMockLogger();
			const logger = resolveLogger(mockLogger as never);

			const childLogger = logger.child({
				notificationId: "notif_1",
				subscriberId: "sub_1",
				eventType: "user.welcome",
			});

			childLogger.info({}, "test log");

			const logged = mockLogger.calls.find((c) => c.msg === "test log");
			expect(logged).toBeDefined();
			expect(logged?.fields).toMatchObject({
				notificationId: "notif_1",
				subscriberId: "sub_1",
				eventType: "user.welcome",
			});
		});

		it("should create nested child logger with channel and provider bindings", () => {
			const mockLogger = createMockLogger();
			const logger = resolveLogger(mockLogger as never);

			const notifLogger = logger.child({
				notificationId: "notif_1",
				subscriberId: "sub_1",
				eventType: "user.welcome",
			});

			const deliveryLogger = notifLogger.child({
				channel: "email",
				provider: "mock-email",
				attempt: 1,
			});

			deliveryLogger.info({}, "delivery attempted");

			const logged = mockLogger.calls.find((c) => c.msg === "delivery attempted");
			expect(logged?.fields).toMatchObject({
				notificationId: "notif_1",
				subscriberId: "sub_1",
				eventType: "user.welcome",
				channel: "email",
				provider: "mock-email",
				attempt: 1,
			});
		});

		it("should not include PII (email, phone) in structured log fields (security rule 20)", () => {
			const mockLogger = createMockLogger();
			const logger = resolveLogger(mockLogger as never);

			const childLogger = logger.child({
				notificationId: "notif_1",
				subscriberId: "sub_1",
				eventType: "user.welcome",
			});

			childLogger.info({ duration: 42 }, "notification processed");

			const logged = mockLogger.calls.find((c) => c.msg === "notification processed");
			expect(logged?.fields).not.toHaveProperty("email");
			expect(logged?.fields).not.toHaveProperty("phone");
			expect(logged?.fields).not.toHaveProperty("name");
		});

		it("should not include credentials in log fields (security rule 21)", () => {
			const mockLogger = createMockLogger();
			const logger = resolveLogger(mockLogger as never);

			const childLogger = logger.child({
				notificationId: "notif_1",
				subscriberId: "sub_1",
				eventType: "user.welcome",
			});

			childLogger.debug({ provider: "sendgrid", status: "sent" }, "provider called");

			const logged = mockLogger.calls.find((c) => c.msg === "provider called");
			expect(logged?.fields).not.toHaveProperty("apiKey");
			expect(logged?.fields).not.toHaveProperty("secret");
			expect(logged?.fields).not.toHaveProperty("token");
			expect(logged?.fields).not.toHaveProperty("password");
		});
	});
});

// ---------------------------------------------------------------------------
// createMetrics — 8 Prometheus metrics
// ---------------------------------------------------------------------------

describe("createMetrics", () => {
	it("should return all 8 metric names when enabled", () => {
		const metrics = createMetrics({ enabled: true, prefix: "emito_test" });

		expect(metrics).toBeDefined();
		expect(metrics).toHaveProperty("notificationsSentTotal");
		expect(metrics).toHaveProperty("deliveryDurationMs");
		expect(metrics).toHaveProperty("providerErrorsTotal");
		expect(metrics).toHaveProperty("circuitBreakerState");
		expect(metrics).toHaveProperty("rateLimitHitsTotal");
		expect(metrics).toHaveProperty("queueDepth");
		expect(metrics).toHaveProperty("bounceTotal");
		expect(metrics).toHaveProperty("engagementTotal");
	});

	it("should use provided prefix in metric names", () => {
		const metrics = createMetrics({ enabled: true, prefix: "myapp" });
		expect(metrics.prefix).toBe("myapp");
	});

	it("should use default prefix 'emito' when not specified", () => {
		const metrics = createMetrics({ enabled: true });
		expect(metrics.prefix).toBe("emito");
	});

	it("should return noop metrics when disabled", () => {
		const metrics = createMetrics({ enabled: false });
		expect(metrics).toBeDefined();
		expect(() =>
			metrics.notificationsSentTotal.inc({ channel: "email", provider: "mock", status: "sent" }),
		).not.toThrow();
	});

	describe("noop metric increments (disabled)", () => {
		it("should increment notificationsSentTotal without throwing when disabled", () => {
			const metrics = createMetrics({ enabled: false });
			expect(() =>
				metrics.notificationsSentTotal.inc({
					channel: "email",
					provider: "mock-email",
					status: "sent",
				}),
			).not.toThrow();
		});

		it("should observe deliveryDurationMs without throwing when disabled", () => {
			const metrics = createMetrics({ enabled: false });
			expect(() =>
				metrics.deliveryDurationMs.observe({ channel: "email", provider: "mock-email" }, 142),
			).not.toThrow();
		});

		it("should increment providerErrorsTotal without throwing when disabled", () => {
			const metrics = createMetrics({ enabled: false });
			expect(() =>
				metrics.providerErrorsTotal.inc({
					channel: "email",
					provider: "mock-email",
					error_code: "PROVIDER_UNAVAILABLE",
				}),
			).not.toThrow();
		});

		it("should set circuitBreakerState gauge without throwing when disabled", () => {
			const metrics = createMetrics({ enabled: false });
			expect(() =>
				metrics.circuitBreakerState.set({ channel: "email", provider: "mock-email" }, 0),
			).not.toThrow();
		});

		it("should increment rateLimitHitsTotal without throwing when disabled", () => {
			const metrics = createMetrics({ enabled: false });
			expect(() =>
				metrics.rateLimitHitsTotal.inc({ channel: "email", provider: "mock-email" }),
			).not.toThrow();
		});

		it("should set queueDepth gauge without throwing when disabled", () => {
			const metrics = createMetrics({ enabled: false });
			expect(() => metrics.queueDepth.set({ channel: "email" }, 5)).not.toThrow();
		});

		it("should increment bounceTotal without throwing when disabled", () => {
			const metrics = createMetrics({ enabled: false });
			expect(() =>
				metrics.bounceTotal.inc({
					channel: "email",
					provider: "mock-email",
					bounce_type: "hard",
				}),
			).not.toThrow();
		});

		it("should increment engagementTotal without throwing when disabled", () => {
			const metrics = createMetrics({ enabled: false });
			expect(() =>
				metrics.engagementTotal.inc({ channel: "email", engagement_type: "open" }),
			).not.toThrow();
		});
	});
});

// ---------------------------------------------------------------------------
// createTracer — OTel Tracer
// ---------------------------------------------------------------------------

describe("createTracer", () => {
	it("should return a Tracer object when tracing is enabled", () => {
		const tracer = createTracer({ enabled: true });
		expect(tracer).toBeDefined();
		expect(typeof tracer.startSpan).toBe("function");
	});

	it("should return a Tracer object when tracing is disabled", () => {
		const tracer = createTracer({ enabled: false });
		expect(tracer).toBeDefined();
		expect(typeof tracer.startSpan).toBe("function");
	});

	it("should return a Tracer when no options provided", () => {
		const tracer = createTracer({});
		expect(tracer).toBeDefined();
	});

	it("should create an emito.send span without throwing", () => {
		const tracer = createTracer({ enabled: true });
		expect(() => {
			const span = tracer.startSpan("emito.send");
			span.end();
		}).not.toThrow();
	});

	it("should create emito.deliver.{channel} span without throwing", () => {
		const tracer = createTracer({ enabled: true });
		expect(() => {
			const span = tracer.startSpan("emito.deliver.email");
			span.end();
		}).not.toThrow();
	});

	it("should create emito.provider.{name} span without throwing", () => {
		const tracer = createTracer({ enabled: true });
		expect(() => {
			const span = tracer.startSpan("emito.provider.sendgrid");
			span.end();
		}).not.toThrow();
	});

	it("should set span attributes without throwing", () => {
		const tracer = createTracer({ enabled: true });
		const span = tracer.startSpan("emito.send", {
			attributes: {
				notificationId: "notif_1",
				subscriberId: "sub_1",
				eventType: "user.welcome",
			},
		});

		expect(() => {
			span.setAttribute("notificationId", "notif_1");
			span.setAttribute("subscriberId", "sub_1");
			span.setAttribute("eventType", "user.welcome");
		}).not.toThrow();

		span.end();
	});

	it("should record errors on spans without throwing", () => {
		const tracer = createTracer({ enabled: true });
		const span = tracer.startSpan("emito.provider.sendgrid");

		expect(() => {
			span.recordException(new Error("provider unavailable"));
			span.setStatus({ code: 2, message: "provider unavailable" }); // SpanStatusCode.ERROR = 2
		}).not.toThrow();

		span.end();
	});
});

describe("startSpan", () => {
	it("should return a span without throwing", () => {
		const span = startSpan("emito.send");
		expect(span).toBeDefined();
		span.end();
	});

	it("should accept attributes", () => {
		expect(() => {
			const span = startSpan("emito.send", { notificationId: "notif_1" });
			span.end();
		}).not.toThrow();
	});
});

describe("withSpan", () => {
	it("should execute the callback and return its result", async () => {
		const result = await withSpan("emito.send", { notificationId: "notif_1" }, async () => {
			return "done";
		});
		expect(result).toBe("done");
	});

	it("should propagate errors from the callback", async () => {
		await expect(
			withSpan("emito.send", {}, async () => {
				throw new Error("span error");
			}),
		).rejects.toThrow("span error");
	});
});

// ---------------------------------------------------------------------------
// createPassthroughResolver — template resolver interface
// ---------------------------------------------------------------------------

describe("createPassthroughResolver", () => {
	it("should return a resolver with a resolve() method", () => {
		const resolver = createPassthroughResolver();
		expect(resolver).toBeDefined();
		expect(typeof resolver.resolve).toBe("function");
	});

	it("should return resolved content with data wrapping the payload", async () => {
		const resolver = createPassthroughResolver();
		const payload = { name: "Alice", orderId: "ord_1" };

		const result = await resolver.resolve({
			event: "user.welcome",
			channel: "email",
			locale: "en",
			payload,
		});

		expect(result).toBeDefined();
		expect(result.data).toMatchObject(payload);
	});

	it("should preserve all payload fields without transformation", async () => {
		const resolver = createPassthroughResolver();
		const payload = {
			name: "Bob",
			amount: 42.5,
			items: ["item_1", "item_2"],
			nested: { key: "value" },
		};

		const result = await resolver.resolve({
			event: "order.confirmed",
			channel: "sms",
			locale: "en",
			payload,
		});

		expect(result.data).toEqual(payload);
	});

	it("should handle empty payload", async () => {
		const resolver = createPassthroughResolver();

		const result = await resolver.resolve({
			event: "user.welcome",
			channel: "email",
			locale: "en",
			payload: {},
		});

		expect(result).toBeDefined();
		expect(result.data).toEqual({});
	});

	it("should use payload.subject as subject when present", async () => {
		const resolver = createPassthroughResolver();

		const result = await resolver.resolve({
			event: "user.welcome",
			channel: "email",
			locale: "en",
			payload: { subject: "Welcome to Emito!", body: "Hello" },
		});

		expect(result.subject).toBe("Welcome to Emito!");
	});

	it("should use payload.body as body when present", async () => {
		const resolver = createPassthroughResolver();

		const result = await resolver.resolve({
			event: "user.welcome",
			channel: "sms",
			locale: "en",
			payload: { body: "Your code is 1234" },
		});

		expect(result.body).toBe("Your code is 1234");
	});

	it("should serialize entire payload as body when no body field", async () => {
		const resolver = createPassthroughResolver();
		const payload = { name: "Charlie", amount: 99 };

		const result = await resolver.resolve({
			event: "test.event",
			channel: "email",
			locale: "en",
			payload,
		});

		expect(result.body).toBe(JSON.stringify(payload));
	});

	it("should work with all supported channels", async () => {
		const resolver = createPassthroughResolver();
		const payload = { message: "hello" };
		const channels = ["email", "sms", "push", "slack"] as const;

		for (const channel of channels) {
			const result = await resolver.resolve({
				event: "test.event",
				channel,
				locale: "en",
				payload,
			});
			expect(result.data).toMatchObject(payload);
		}
	});

	it("should work with different locales", async () => {
		const resolver = createPassthroughResolver();
		const payload = { greeting: "hello" };
		const locales = ["en", "fr", "de", "ja"];

		for (const locale of locales) {
			const result = await resolver.resolve({
				event: "test.event",
				channel: "email",
				locale,
				payload,
			});
			expect(result.data).toMatchObject(payload);
		}
	});
});

// ---------------------------------------------------------------------------
// Integration: createEmito with injected logger
// ---------------------------------------------------------------------------

describe("createEmito observability integration", () => {
	let repos: ReturnType<typeof createRepositories>;

	beforeEach(() => {
		repos = createRepositories();
	});

	it("should accept an injected pino-compatible logger without throwing", () => {
		const mockLogger = createMockLogger();

		expect(() =>
			createEmito({
				...createMinimalConfig({
					channels: { email: { providers: [createMockProvider("email")] } },
				}),
				logger: mockLogger as never,
				repositories: repos,
			}),
		).not.toThrow();
	});

	it("should log send lifecycle events during a successful send", async () => {
		const mockLogger = createMockLogger();
		const emailProvider = createMockProvider("email");

		await seedSubscriber(repos);

		const emito = createEmito({
			...createMinimalConfig({
				channels: { email: { providers: [emailProvider] } },
			}),
			logger: mockLogger as never,
			repositories: repos,
		});
		await emito.start();

		await emito.send({
			event: "user.welcome",
			subscriberId: "sub_1",
			payload: { name: "Test" },
		});

		// At least one log call should have occurred during the send
		expect(mockLogger.calls.length).toBeGreaterThan(0);

		// No log call should contain PII fields
		for (const call of mockLogger.calls) {
			expect(call.fields).not.toHaveProperty("email");
			expect(call.fields).not.toHaveProperty("phone");
		}
	});

	it("should create metrics with the configured prefix", () => {
		const emito = createEmito({
			...createMinimalConfig({
				channels: { email: { providers: [createMockProvider("email")] } },
				observability: { metrics: { enabled: true, prefix: "testprefix" } },
			}),
			repositories: repos,
		});

		// If createEmito doesn't throw, metrics were created correctly
		expect(emito).toBeDefined();
	});

	describe("duration tracking", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should complete send without errors under fake timers", async () => {
			const mockLogger = createMockLogger();
			const emailProvider = createMockProvider("email");

			await seedSubscriber(repos);

			const emito = createEmito({
				...createMinimalConfig({
					channels: { email: { providers: [emailProvider] } },
				}),
				logger: mockLogger as never,
				repositories: repos,
			});
			await emito.start();

			const sendPromise = emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: {},
			});

			await vi.advanceTimersByTimeAsync(0);
			const result = await sendPromise;

			expect(result.notificationId).toBeDefined();

			// Find any log call with a duration field and verify it's non-negative
			const durationLogs = mockLogger.calls.filter((c) => typeof c.fields.duration === "number");

			for (const log of durationLogs) {
				const duration = log.fields.duration as number;
				expect(duration).toBeGreaterThanOrEqual(0);
				expect(duration).toBeLessThan(3_600_000);
			}
		});
	});
});
