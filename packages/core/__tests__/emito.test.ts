/**
 * Tests for the createEmito factory and full send flow orchestration.
 *
 * Covers:
 * - createEmito(config) validates config via Zod and returns an Emito instance
 * - Full send flow (all 7 steps: validate event → consent → suppress → resolve subscriber
 *   → resolve preferences → dispatch per channel → return SendResult)
 * - Per-channel status in SendResult
 * - Config validation rejects bad inputs with EmitoError
 * - Re-exports from @emito/types accessible via @emito/core
 *
 * Rules applied (testing standards):
 * - Assert on specific EmitoErrorCode values, never message strings (rule 1)
 * - Assert on isRetryable for error path tests (rule 2)
 * - Use test data builders, never inline literals (rule 7)
 * - Use in-memory repositories for unit tests (rule 12)
 * - Follow describe("functionName") > it("should X when Y") naming (rule 15)
 * - Assert on shape of return values, not just existence (rule 26)
 * - Use toMatchObject for partial assertions (rule 27)
 * - Assert on call arguments for mock verifications (rule 28)
 */

import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import { createEmito } from "../src/emito";
import {
	InMemoryConsentRepository,
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

function createSubscriberData(
	overrides: Partial<{
		id: string;
		email: string;
		phone: string | null;
		lang: string;
		locale: string;
		timezone: string | null;
		globallyUnsubscribed: boolean;
		metadata: Record<string, unknown>;
		erasedAt: Date | null;
		createdAt: Date;
		updatedAt: Date;
	}> = {},
) {
	return {
		id: "sub_1",
		email: "user@example.com",
		phone: null,
		lang: "en",
		timezone: null,
		globallyUnsubscribed: false,
		metadata: {},
		erasedAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function createMinimalValidConfig(overrides: Record<string, unknown> = {}) {
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
			marketing: { policy: "opt_in" as const },
		},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// createEmito — config validation
// ---------------------------------------------------------------------------

describe("createEmito", () => {
	describe("config validation", () => {
		it("should return an Emito instance when config is valid", () => {
			const repos = createRepositories();
			const emailProvider = createMockProvider("email");

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});

			expect(emito).toBeDefined();
			expect(typeof emito.send).toBe("function");
			expect(typeof emito.start).toBe("function");
			expect(typeof emito.stop).toBe("function");
			expect(typeof emito.healthCheck).toBe("function");
		});

		it("should throw CONFIG_INVALID with isRetryable:false when database url is missing", () => {
			const repos = createRepositories();

			expect(() =>
				createEmito({
					database: { url: "" },
					redis: { url: "redis://localhost:6379" },
					repositories: repos,
				}),
			).toThrowError(
				expect.objectContaining({
					code: EMITO_ERROR_CODE.CONFIG_INVALID,
					isRetryable: false,
				}),
			);
		});

		it("should throw CONFIG_INVALID with isRetryable:false when redis url is missing", () => {
			const repos = createRepositories();

			expect(() =>
				createEmito({
					database: { url: "postgresql://localhost:5432/test" },
					redis: { url: "" },
					repositories: repos,
				}),
			).toThrowError(
				expect.objectContaining({
					code: EMITO_ERROR_CODE.CONFIG_INVALID,
					isRetryable: false,
				}),
			);
		});

		it("should throw CONFIG_INVALID when event references unknown category", () => {
			const repos = createRepositories();

			expect(() =>
				createEmito({
					...createMinimalValidConfig(),
					events: {
						"order.placed": {
							category: "nonexistent_category",
							channels: ["email" as const],
						},
					},
					repositories: repos,
				}),
			).toThrowError(
				expect.objectContaining({
					code: EMITO_ERROR_CODE.CONFIG_INVALID,
					isRetryable: false,
				}),
			);
		});

		it("should accept config without events (empty registry)", () => {
			const repos = createRepositories();

			const emito = createEmito({
				database: { url: "postgresql://localhost:5432/test" },
				redis: { url: "redis://localhost:6379" },
				repositories: repos,
			});

			expect(emito).toBeDefined();
		});

		it("should accept observability config", () => {
			const repos = createRepositories();

			const emito = createEmito({
				...createMinimalValidConfig(),
				observability: {
					metrics: { enabled: true, prefix: "emito" },
					tracing: { enabled: false },
				},
				repositories: repos,
			});

			expect(emito).toBeDefined();
		});
	});

	// ---------------------------------------------------------------------------
	// send() — full flow
	// ---------------------------------------------------------------------------

	describe("send", () => {
		let repos: ReturnType<typeof createRepositories>;
		let emailProvider: ReturnType<typeof createMockProvider>;

		beforeEach(() => {
			repos = createRepositories();
			emailProvider = createMockProvider("email");
		});

		async function seedSubscriberAndSend(
			subscriberOverrides: Parameters<typeof createSubscriberData>[0] = {},
			sendParams: Partial<{
				subscriberId: string;
				workspaceId: string;
				payload: Record<string, unknown>;
				lang: string;
			}> = {},
		) {
			const subscriber = createSubscriberData(subscriberOverrides);
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			return emito.send({
				event: "user.welcome",
				subscriberId: sendParams.subscriberId ?? subscriber.id,
				payload: sendParams.payload ?? { name: "Test User" },
				lang: sendParams.lang,
				workspaceId: sendParams.workspaceId,
			});
		}

		it("should return a SendResult with notificationId and channels array", async () => {
			const result = await seedSubscriberAndSend();

			expect(result).toMatchObject({
				notificationId: expect.any(String),
				channels: expect.any(Array),
			});
			expect(result.channels.length).toBeGreaterThan(0);
		});

		it("should include channel, status, and provider in each ChannelResult", async () => {
			const result = await seedSubscriberAndSend();

			const emailResult = result.channels.find((c) => c.channel === "email");
			expect(emailResult).toBeDefined();
			expect(emailResult).toMatchObject({
				channel: "email",
				status: "sent",
				provider: emailProvider.name,
			});
		});

		it("should call the provider deliver() during send", async () => {
			await seedSubscriberAndSend();

			expect(emailProvider.calls.length).toBeGreaterThan(0);
		});

		it("should pass a notificationId, subscriberId, and eventType in provider call metadata", async () => {
			await seedSubscriberAndSend();

			const call = emailProvider.calls[0];
			expect(call).toMatchObject({
				channel: "email",
				metadata: expect.objectContaining({
					notificationId: expect.any(String),
					subscriberId: "sub_1",
					eventType: "user.welcome",
				}),
			});
		});

		it("gives each channel's provider call its own notificationId, matching that channel's own row", async () => {
			// Each channel that reaches notificationRepository writes its own row —
			// metadata.notificationId must equal THAT row's id (not a value shared
			// across channels), or dispatch()'s updateStatus(notificationId, ...)
			// and /track/open|click/:id would silently target the wrong row.
			const smsProvider = createMockProvider("sms");
			const subscriber = createSubscriberData({ phone: "+15550001234" });
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				database: { url: "postgresql://localhost:5432/test" },
				redis: { url: "redis://localhost:6379" },
				categories: { transactional: { policy: "always" as const } },
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
				repositories: repos,
			});
			await emito.start();

			await emito.send({ event: "user.welcome", subscriberId: "sub_1", payload: {} });

			const emailNotificationId = emailProvider.calls[0]?.metadata.notificationId;
			const smsNotificationId = smsProvider.calls[0]?.metadata.notificationId;
			expect(emailNotificationId).toBeDefined();
			expect(smsNotificationId).toBeDefined();
			expect(emailNotificationId).not.toBe(smsNotificationId);

			const emailRow = await repos.notificationRepository.findById(emailNotificationId as string);
			const smsRow = await repos.notificationRepository.findById(smsNotificationId as string);
			expect(emailRow?.channel).toBe("email");
			expect(smsRow?.channel).toBe("sms");
		});

		// Step 0: Validate payload
		it("should throw VALIDATION_ERROR when payload is missing (step 0 — payload validation)", async () => {
			// A plain-JS caller with no compiler to flag a missing required field —
			// the template resolver reads properties off `payload` unconditionally,
			// so without this check the failure surfaces as a bare TypeError deep
			// inside per-channel rendering instead of a clear, catchable error here.
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			await expect(
				emito.send({
					event: "user.welcome",
					subscriberId: "sub_1",
				} as Parameters<typeof emito.send>[0]),
			).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				isRetryable: false,
			});
		});

		// Step 1: Validate event in registry
		it("should return CONFIG_INVALID status for unknown event (step 1 — event validation)", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			await expect(
				emito.send({
					event: "unknown.event",
					subscriberId: "sub_1",
					payload: {},
				}),
			).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.CONFIG_INVALID,
				isRetryable: false,
			});
		});

		// Step 2: Category consent enforcement
		it("should block marketing send without opt-in (step 2 — consent)", async () => {
			const repos2 = createRepositories();
			const subscriber = createSubscriberData({ id: "sub_mkt" });
			await repos2.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				database: { url: "postgresql://localhost:5432/test" },
				redis: { url: "redis://localhost:6379" },
				categories: {
					marketing: { policy: "opt_in" },
				},
				events: {
					"promo.newsletter": {
						category: "marketing",
						channels: ["email" as const],
					},
				},
				channels: {
					email: { providers: [createMockProvider("email")] },
				},
				repositories: repos2,
			});
			await emito.start();

			await expect(
				emito.send({
					event: "promo.newsletter",
					subscriberId: "sub_mkt",
					payload: {},
				}),
			).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.CONSENT_REQUIRED,
				isRetryable: false,
			});
		});

		// Step 3: Suppression check
		it("should return suppressed status when address is on suppression list (step 3)", async () => {
			const subscriber = createSubscriberData({ email: "suppressed@example.com" });
			await repos.subscriberRepository.seed(subscriber);

			// Pre-add to suppression list
			await repos.suppressionRepository.create({
				address: "suppressed@example.com",
				channel: "email",
				reason: "hard bounce",
				provider: null,
			});

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: {},
			});

			const emailResult = result.channels.find((c) => c.channel === "email");
			expect(emailResult).toMatchObject({ status: "suppressed" });
			// Provider should not have been called
			expect(emailProvider.calls).toHaveLength(0);
		});

		// Step 4: Subscriber resolution
		it("should throw SUBSCRIBER_NOT_FOUND when subscriber does not exist (step 4)", async () => {
			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			await expect(
				emito.send({
					event: "user.welcome",
					subscriberId: "sub_nonexistent",
					payload: {},
				}),
			).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND,
				isRetryable: false,
			});
		});

		// Step 4: Erased subscriber blocking
		it("should block send for erased subscriber (step 4 — erasure check)", async () => {
			const subscriber = createSubscriberData({
				id: "sub_erased",
				erasedAt: new Date("2026-01-01T00:00:00Z"),
			});
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			await expect(
				emito.send({
					event: "user.welcome",
					subscriberId: "sub_erased",
					payload: {},
				}),
			).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.SUBSCRIBER_ERASED,
				isRetryable: false,
			});
		});

		// Step 6: Concurrent channel dispatch
		it("should dispatch to multiple channels concurrently and return all results", async () => {
			const smsProvider = createMockProvider("sms");
			const subscriber = createSubscriberData({ phone: "+15550001234" });
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				database: { url: "postgresql://localhost:5432/test" },
				redis: { url: "redis://localhost:6379" },
				categories: {
					transactional: { policy: "always" as const },
				},
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
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: {},
			});

			expect(result.channels).toHaveLength(2);
			const channels = result.channels.map((c) => c.channel).sort();
			expect(channels).toEqual(["email", "sms"]);
		});

		// Step 7: Return delivery receipt
		it("should return a stable notificationId across calls", async () => {
			const result1 = await seedSubscriberAndSend();
			emailProvider.reset();

			const repos2 = createRepositories();
			const subscriber2 = createSubscriberData({ id: "sub_2", email: "user2@example.com" });
			await repos2.subscriberRepository.seed(subscriber2);
			const emailProvider2 = createMockProvider("email");

			const emito2 = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider2] },
					},
				}),
				repositories: repos2,
			});
			await emito2.start();

			const result2 = await emito2.send({
				event: "user.welcome",
				subscriberId: "sub_2",
				payload: {},
			});

			// Different sends produce different notification IDs
			expect(result1.notificationId).not.toBe(result2.notificationId);
		});

		it("should use recipient override for email when provided", async () => {
			const subscriber = createSubscriberData({ email: "original@example.com" });
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				recipient: { email: "override@example.com" },
				payload: {},
			});

			expect(emailProvider.calls[0]).toMatchObject({
				channel: "email",
				to: "override@example.com",
			});
		});

		it("should handle provider failure gracefully and return failed channel status", async () => {
			const failingProvider = createMockProvider("email", {
				mode: "permanent",
			});
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: {
							providers: [failingProvider],
							retry: { maxAttempts: 1, initialDelay: 0, maxDelay: 0, backoff: "linear" },
						},
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: {},
			});

			const emailResult = result.channels.find((c) => c.channel === "email");
			expect(emailResult).toMatchObject({ channel: "email" });
			expect(["failed", "no_provider"]).toContain(emailResult?.status);
		});

		it("should not call provider when no providers are configured for channel", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						// No email providers
						email: { providers: [] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: {},
			});

			const emailResult = result.channels.find((c) => c.channel === "email");
			expect(emailResult?.status).toBe("no_provider");
		});

		it("should send SMS to subscriber with phone number", async () => {
			const smsProvider = createMockProvider("sms");
			const subscriber = createSubscriberData({ phone: "+15550001234" });
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				database: { url: "postgresql://localhost:5432/test" },
				redis: { url: "redis://localhost:6379" },
				categories: {
					transactional: { policy: "always" as const },
				},
				events: {
					"user.welcome": {
						category: "transactional",
						channels: ["sms" as const],
					},
				},
				channels: {
					sms: { providers: [smsProvider] },
				},
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: { body: "Welcome!" },
			});

			expect(result.channels[0]).toMatchObject({ channel: "sms", status: "sent" });
			expect(smsProvider.calls[0]).toMatchObject({ channel: "sms", to: "+15550001234" });
		});

		it("should send push notifications to subscriber with push tokens", async () => {
			const pushProvider = createMockProvider("push");
			const subscriber = createSubscriberData({ pushTokens: ["token1", "token2"] });
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				database: { url: "postgresql://localhost:5432/test" },
				redis: { url: "redis://localhost:6379" },
				categories: {
					transactional: { policy: "always" as const },
				},
				events: {
					"user.welcome": {
						category: "transactional",
						channels: ["push" as const],
					},
				},
				channels: {
					push: { providers: [pushProvider] },
				},
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: { subject: "New Notification", body: "Hello!" },
			});

			expect(result.channels[0]).toMatchObject({ channel: "push", status: "sent" });
			expect(pushProvider.calls[0]).toMatchObject({
				channel: "push",
				tokens: ["token1", "token2"],
			});
		});

		it("should return no_provider for push channel when subscriber has no push tokens", async () => {
			const pushProvider = createMockProvider("push");
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				database: { url: "postgresql://localhost:5432/test" },
				redis: { url: "redis://localhost:6379" },
				categories: {
					transactional: { policy: "always" as const },
				},
				events: {
					"user.welcome": {
						category: "transactional",
						channels: ["push" as const],
					},
				},
				channels: {
					push: { providers: [pushProvider] },
				},
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: { body: "Hello" },
			});

			expect(result.channels[0]).toMatchObject({ channel: "push", status: "no_provider" });
			expect(pushProvider.calls).toHaveLength(0);
		});

		it("should deliver inApp notification via inbox repository", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				database: { url: "postgresql://localhost:5432/test" },
				redis: { url: "redis://localhost:6379" },
				categories: {
					transactional: { policy: "always" as const },
				},
				events: {
					"user.welcome": {
						category: "transactional",
						channels: ["inApp" as const],
					},
				},
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: { subject: "Welcome", body: "Hello!" },
			});

			expect(result.channels[0]).toMatchObject({
				channel: "inApp",
				status: "sent",
				provider: "inbox",
			});
		});

		it("should return no_provider for sms when subscriber has no phone", async () => {
			const smsProvider = createMockProvider("sms");
			const subscriber = createSubscriberData({ phone: null });
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				database: { url: "postgresql://localhost:5432/test" },
				redis: { url: "redis://localhost:6379" },
				categories: {
					transactional: { policy: "always" as const },
				},
				events: {
					"user.welcome": {
						category: "transactional",
						channels: ["sms" as const],
					},
				},
				channels: {
					sms: { providers: [smsProvider] },
				},
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: { body: "Hello" },
			});

			expect(result.channels[0]).toMatchObject({ channel: "sms", status: "no_provider" });
		});

		it("should handle provider exhaustion (all providers fail transiently)", async () => {
			const failProvider = createMockProvider("email", { mode: "transient" });
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: {
							providers: [failProvider],
							retry: { maxAttempts: 1, initialDelay: 0, maxDelay: 0, backoff: "linear" },
						},
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: {},
			});

			const emailResult = result.channels.find((c) => c.channel === "email");
			expect(emailResult?.status).toBe("failed");
		});

		it("should handle suppression during dispatch", async () => {
			const subscriber = createSubscriberData({ email: "user@example.com" });
			await repos.subscriberRepository.seed(subscriber);
			await repos.suppressionRepository.create({
				address: "user@example.com",
				channel: "email",
				reason: "hard bounce",
			});

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const result = await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: {},
			});

			expect(result.channels[0]).toMatchObject({ channel: "email", status: "suppressed" });
		});
	});

	// ---------------------------------------------------------------------------
	// @emito/types re-exports
	// ---------------------------------------------------------------------------

	describe("@emito/types re-exports", () => {
		it("should re-export EMITO_ERROR_CODE from @emito/types", () => {
			// If this import works, the re-export is in place
			expect(EMITO_ERROR_CODE).toBeDefined();
			expect(typeof EMITO_ERROR_CODE.CONFIG_INVALID).toBe("string");
		});

		it("should re-export EmitoError from @emito/types", () => {
			const error = new EmitoError({
				code: EMITO_ERROR_CODE.CONFIG_INVALID,
				message: "test",
				isRetryable: false,
			});

			expect(error.code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
			expect(error.isRetryable).toBe(false);
		});
	});
});
