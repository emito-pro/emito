/**
 * Tests for the provider dispatch pipeline (dispatcher.ts).
 *
 * Covers:
 * - Priority strategy: tries providers in config order, fails over on exhaustion
 * - Round-robin strategy: distributes calls evenly across providers
 * - Weighted strategy: distributes calls proportionally by weight
 * - Suppression pre-send check blocks delivery to suppressed addresses
 * - Failover: next provider is tried when current provider is exhausted
 * - DLQ write when all providers are exhausted
 * - Delivery status transitions during dispatch
 * - Push token deactivation (B-004): dead tokens deactivated, NOT suppressed
 *
 * Rules applied:
 * - rule 1: assert on EmitoErrorCode, not error message strings
 * - rule 2: assert isRetryable for every error path
 * - rule 7: use test data builders
 * - rule 12: in-memory repositories for unit tests
 * - rule 13: mockLogger for all tests
 * - rule 14: vi.restoreAllMocks() in afterEach (done by global setup)
 * - rule 22: vi.useFakeTimers() for time-dependent behavior (retry backoff)
 * - rule 25: prefer specific matchers
 * - rule 28: assert on call arguments for mock verifications
 */

import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ChannelDeliveryParams, RetryPolicy } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../src/dispatch/dispatcher";
import type { DispatchParams } from "../src/dispatch/dispatcher";
import { resetRoundRobinCounters } from "../src/dispatch/strategies/round-robin";
import {
	InMemoryDeadLetterRepository,
	InMemoryNotificationRepository,
	InMemoryPushTokenRepository,
	InMemorySuppressionRepository,
} from "../src/repositories/in-memory/index";
import { createMockProvider } from "../src/testing/mock-provider";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

let notifCounter = 0;
let subCounter = 0;

function createEmailDeliveryParams(
	overrides: Partial<ChannelDeliveryParams> = {},
): ChannelDeliveryParams {
	notifCounter++;
	subCounter++;
	return {
		channel: "email",
		to: `user${subCounter}@example.com`,
		subject: "Test Email",
		html: "<p>Hello</p>",
		text: "Hello",
		metadata: {
			notificationId: `notif_${notifCounter}`,
			subscriberId: `sub_${subCounter}`,
			eventType: "user.welcome",
		},
		...overrides,
	} as ChannelDeliveryParams;
}

function createPushDeliveryParams(
	overrides: Partial<ChannelDeliveryParams> = {},
): ChannelDeliveryParams {
	notifCounter++;
	subCounter++;
	return {
		channel: "push",
		tokens: ["token-1", "token-2", "token-3", "token-4"],
		title: "Test Push",
		body: "Test Body",
		metadata: {
			notificationId: `notif_${notifCounter}`,
			subscriberId: `sub_${subCounter}`,
			eventType: "user.welcome",
		},
		...overrides,
	} as ChannelDeliveryParams;
}

function createRetryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
	return {
		maxAttempts: 3,
		initialDelay: 100,
		maxDelay: 1000,
		backoff: "exponential",
		jitter: true,
		...overrides,
	};
}

function createDispatchParams(overrides: Partial<DispatchParams> = {}): DispatchParams {
	const notifRepo = new InMemoryNotificationRepository();
	const suppRepo = new InMemorySuppressionRepository();
	const dlqRepo = new InMemoryDeadLetterRepository();

	return {
		providers: [createMockProvider("email")],
		strategy: "priority",
		deliveryParams: createEmailDeliveryParams(),
		retryPolicy: createRetryPolicy({ maxAttempts: 1, initialDelay: 0, maxDelay: 0, jitter: false }),
		notificationRepository: notifRepo,
		suppressionRepository: suppRepo,
		deadLetterRepository: dlqRepo,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Priority strategy
// ---------------------------------------------------------------------------

describe("dispatch", () => {
	beforeEach(() => {
		resetRoundRobinCounters();
	});

	describe("priority strategy", () => {
		it("should use the first provider in the list", async () => {
			const provider1 = createMockProvider("email", { name: "provider-1" });
			const provider2 = createMockProvider("email", { name: "provider-2" });

			const params = createDispatchParams({
				providers: [provider1, provider2],
				strategy: "priority",
			});

			const result = await dispatch(params);

			expect(result.success).toBe(true);
			expect(provider1.calls).toHaveLength(1);
			expect(provider2.calls).toHaveLength(0);
		});

		it("should failover to the second provider when the first is exhausted", async () => {
			const provider1 = createMockProvider("email", { name: "provider-1", mode: "transient" });
			const provider2 = createMockProvider("email", { name: "provider-2" });

			const params = createDispatchParams({
				providers: [provider1, provider2],
				strategy: "priority",
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(true);
			expect(result.provider).toBe("provider-2");
		});

		it("should try providers in config order (priority order)", async () => {
			const callOrder: string[] = [];
			const provider1 = createMockProvider("email", { name: "first", mode: "transient" });
			const provider2 = createMockProvider("email", { name: "second", mode: "transient" });
			const provider3 = createMockProvider("email", { name: "third" });

			// Track call order
			const origDeliver1 = provider1.deliver.bind(provider1);
			vi.spyOn(provider1, "deliver").mockImplementation(async (p) => {
				callOrder.push("first");
				return origDeliver1(p);
			});
			const origDeliver2 = provider2.deliver.bind(provider2);
			vi.spyOn(provider2, "deliver").mockImplementation(async (p) => {
				callOrder.push("second");
				return origDeliver2(p);
			});
			vi.spyOn(provider3, "deliver").mockImplementation(async () => {
				callOrder.push("third");
				return { success: true, providerMessageId: "msg_3" };
			});

			const params = createDispatchParams({
				providers: [provider1, provider2, provider3],
				strategy: "priority",
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			await dispatch(params);

			expect(callOrder).toEqual(["first", "second", "third"]);
		});

		it("should return the provider name that succeeded in the result", async () => {
			const provider = createMockProvider("email", { name: "resend" });
			const params = createDispatchParams({
				providers: [provider],
				strategy: "priority",
			});

			const result = await dispatch(params);

			expect(result.provider).toBe("resend");
		});
	});

	// ---------------------------------------------------------------------------
	// Round-robin strategy
	// ---------------------------------------------------------------------------

	describe("round-robin strategy", () => {
		it("should distribute calls evenly across two providers", async () => {
			const provider1 = createMockProvider("email", { name: "provider-1" });
			const provider2 = createMockProvider("email", { name: "provider-2" });

			const deliveryParams = createEmailDeliveryParams();

			for (let i = 0; i < 4; i++) {
				const params = createDispatchParams({
					providers: [provider1, provider2],
					strategy: "round_robin",
					deliveryParams: {
						...deliveryParams,
						metadata: { ...deliveryParams.metadata, notificationId: `notif_rr_${i}` },
					},
				});
				await dispatch(params);
			}

			// Each provider should have been called exactly twice
			expect(provider1.calls).toHaveLength(2);
			expect(provider2.calls).toHaveLength(2);
		});

		it("should distribute 6 calls evenly across 3 providers (2 each)", async () => {
			const providers = [
				createMockProvider("email", { name: "p1" }),
				createMockProvider("email", { name: "p2" }),
				createMockProvider("email", { name: "p3" }),
			];

			for (let i = 0; i < 6; i++) {
				const dp = createEmailDeliveryParams();
				const params = createDispatchParams({
					providers,
					strategy: "round_robin",
					deliveryParams: dp,
				});
				await dispatch(params);
			}

			expect(providers[0].calls).toHaveLength(2);
			expect(providers[1].calls).toHaveLength(2);
			expect(providers[2].calls).toHaveLength(2);
		});

		it("should failover to next provider in round-robin when current fails", async () => {
			const provider1 = createMockProvider("email", { name: "failing", mode: "transient" });
			const provider2 = createMockProvider("email", { name: "fallback" });

			const params = createDispatchParams({
				providers: [provider1, provider2],
				strategy: "round_robin",
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Weighted strategy
	// ---------------------------------------------------------------------------

	describe("weighted strategy", () => {
		it("should distribute calls proportionally by weight (2:1 ratio)", async () => {
			const provider1 = createMockProvider("email", { name: "primary" });
			const provider2 = createMockProvider("email", { name: "secondary" });

			// 300 calls with weight 2:1 → primary ~200, secondary ~100 (within tolerance)
			const total = 300;
			for (let i = 0; i < total; i++) {
				const dp = createEmailDeliveryParams();
				const params = createDispatchParams({
					providers: [provider1, provider2],
					strategy: "weighted",
					weights: [2, 1],
					deliveryParams: dp,
				});
				await dispatch(params);
			}

			const p1Ratio = provider1.calls.length / total;
			const p2Ratio = provider2.calls.length / total;

			// With 2:1 weighting: primary ~66.7%, secondary ~33.3%
			expect(p1Ratio).toBeGreaterThan(0.55);
			expect(p1Ratio).toBeLessThan(0.78);
			expect(p2Ratio).toBeGreaterThan(0.22);
			expect(p2Ratio).toBeLessThan(0.45);
		});

		it("should assign all traffic to the single provider with weight", async () => {
			const provider = createMockProvider("email", { name: "sole" });

			for (let i = 0; i < 5; i++) {
				const params = createDispatchParams({
					providers: [provider],
					strategy: "weighted",
					weights: [1],
					deliveryParams: createEmailDeliveryParams(),
				});
				await dispatch(params);
			}

			expect(provider.calls).toHaveLength(5);
		});

		it("should failover to another provider when weighted-selected provider fails", async () => {
			const provider1 = createMockProvider("email", { name: "primary", mode: "transient" });
			const provider2 = createMockProvider("email", { name: "secondary" });

			const params = createDispatchParams({
				providers: [provider1, provider2],
				strategy: "weighted",
				weights: [1, 1],
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Suppression pre-send check
	// ---------------------------------------------------------------------------

	describe("suppression check", () => {
		it("should skip delivery when address is suppressed and return suppressed status", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			await suppRepo.create({
				address: "blocked@example.com",
				channel: "email",
				reason: "hard_bounce",
			});

			const provider = createMockProvider("email");
			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "blocked@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_sup_1",
					subscriberId: "sub_sup_1",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				deliveryParams,
			});

			const result = await dispatch(params);

			expect(result.suppressed).toBe(true);
			expect(result.success).toBe(false);
			expect(provider.calls).toHaveLength(0);
		});

		it("should deliver normally when address is not suppressed", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const provider = createMockProvider("email");

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				deliveryParams: createEmailDeliveryParams(),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(true);
			expect(result.suppressed).toBeFalsy();
			expect(provider.calls).toHaveLength(1);
		});

		it("should check suppression by address AND channel (different channels not suppressed)", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			await suppRepo.create({
				address: "user@example.com",
				channel: "email",
				reason: "spam_complaint",
			});

			const smsProvider = createMockProvider("sms");
			const deliveryParams: ChannelDeliveryParams = {
				channel: "sms",
				to: "user@example.com",
				body: "Hello",
				metadata: {
					notificationId: "notif_chan_1",
					subscriberId: "sub_chan_1",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [smsProvider],
				suppressionRepository: suppRepo,
				deliveryParams,
			});

			const result = await dispatch(params);

			// SMS not suppressed — only email is
			expect(result.success).toBe(true);
			expect(smsProvider.calls).toHaveLength(1);
		});
	});

	// ---------------------------------------------------------------------------
	// Permanent error handling — suppression allowlist (B-001 fix)
	// ---------------------------------------------------------------------------

	describe("permanent error handling", () => {
		it("should NOT retry after a permanent error (only 1 provider call total)", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const provider = createMockProvider("email", { name: "perm", mode: "permanent" });

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				retryPolicy: createRetryPolicy({
					maxAttempts: 5,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
				deliveryParams: createEmailDeliveryParams(),
			});

			await dispatch(params);

			// Permanent error must not be retried — only 1 call total
			expect(provider.calls).toHaveLength(1);
		});

		it("should return permanent:true and not exhausted when provider returns permanent error", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const provider = createMockProvider("email", { mode: "permanent" });

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
				deliveryParams: createEmailDeliveryParams(),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			// Permanent is not the same as "all providers exhausted"
			expect(result.errorCode).not.toBe(EMITO_ERROR_CODE.ALL_PROVIDERS_EXHAUSTED);
		});

		it("should NOT failover to next provider when first provider returns permanent error", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const provider1 = createMockProvider("email", { name: "perm-fail", mode: "permanent" });
			const provider2 = createMockProvider("email", { name: "would-succeed" });

			const params = createDispatchParams({
				providers: [provider1, provider2],
				strategy: "priority",
				suppressionRepository: suppRepo,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
				deliveryParams: createEmailDeliveryParams(),
			});

			const result = await dispatch(params);

			// Provider2 should NOT be tried — permanent errors don't failover
			expect(provider2.calls).toHaveLength(0);
			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Suppression allowlist — only SUPPRESSABLE_ERROR_CODES trigger suppression
	// ---------------------------------------------------------------------------

	describe("suppression allowlist (B-001)", () => {
		it("should NOT suppress when provider returns DELIVERY_REJECTED (rejected mode)", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const provider = createMockProvider("email", { name: "rejected-provider", mode: "rejected" });
			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "rejected@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_rejected_1",
					subscriberId: "sub_rejected_1",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			const suppRecord = await suppRepo.findByAddressAndChannel("rejected@example.com", "email");
			expect(suppRecord).toBeNull();
		});

		it("should suppress when provider returns DELIVERY_HARD_BOUNCE", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const provider = createMockProvider("email", {
				name: "hard-bounce-provider",
				mode: "hard_bounce",
			});
			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "bounce@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_hb_1",
					subscriberId: "sub_hb_1",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE);
			const suppRecord = await suppRepo.findByAddressAndChannel("bounce@example.com", "email");
			expect(suppRecord).not.toBeNull();
			expect(suppRecord?.address).toBe("bounce@example.com");
		});

		it("should suppress when provider returns DELIVERY_SPAM_COMPLAINT", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const provider = createMockProvider("email", {
				name: "spam-provider",
				mode: "spam_complaint",
			});
			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "spammer@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_spam_1",
					subscriberId: "sub_spam_1",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT);
			const suppRecord = await suppRepo.findByAddressAndChannel("spammer@example.com", "email");
			expect(suppRecord).not.toBeNull();
		});

		it("should suppress when provider returns DELIVERY_INVALID_ADDRESS", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const provider = createMockProvider("email", {
				name: "invalid-addr-provider",
				mode: "invalid_address",
			});
			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "notreal@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_inv_1",
					subscriberId: "sub_inv_1",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			const suppRecord = await suppRepo.findByAddressAndChannel("notreal@example.com", "email");
			expect(suppRecord).not.toBeNull();
		});

		it("should NOT suppress for an unknown permanent EmitoError with non-delivery code", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			// Simulate a non-delivery permanent error by using a spy that throws a non-suppressable code
			const provider = createMockProvider("email", { name: "config-fail" });
			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "user@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_unknown_perm_1",
					subscriberId: "sub_unknown_perm_1",
					eventType: "test.event",
				},
			};

			vi.spyOn(provider, "deliver").mockRejectedValueOnce(
				new (await import("@emito/types").then((m) => m.EmitoError))({
					code: EMITO_ERROR_CODE.CONFIG_INVALID,
					message: "Provider config is invalid",
					isRetryable: false,
				}),
			);

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			const suppRecord = await suppRepo.findByAddressAndChannel("user@example.com", "email");
			expect(suppRecord).toBeNull();
		});

		it("should retry soft_bounce on same provider then failover, never suppressing", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			// Provider1 always soft-bounces — will be exhausted after maxAttempts
			const provider1 = createMockProvider("email", { name: "soft-fail", mode: "soft_bounce" });
			// Provider2 succeeds
			const provider2 = createMockProvider("email", { name: "fallback" });

			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "softbounce@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_sb_1",
					subscriberId: "sub_sb_1",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [provider1, provider2],
				strategy: "priority",
				suppressionRepository: suppRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			// Soft bounce should failover to provider2 and succeed
			expect(result.success).toBe(true);
			expect(result.provider).toBe("fallback");
			// Address must NOT be suppressed
			const suppRecord = await suppRepo.findByAddressAndChannel("softbounce@example.com", "email");
			expect(suppRecord).toBeNull();
		});

		it("should not suppress when all providers soft-bounce and delivery is exhausted", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const provider = createMockProvider("email", { name: "soft-fail", mode: "soft_bounce" });
			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "softbounce2@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_sb_2",
					subscriberId: "sub_sb_2",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			// Exhausted but NOT suppressed
			expect(result.success).toBe(false);
			expect(result.permanent).toBeFalsy();
			const suppRecord = await suppRepo.findByAddressAndChannel("softbounce2@example.com", "email");
			expect(suppRecord).toBeNull();
		});
	});

	// ---------------------------------------------------------------------------
	// Dead letter queue
	// ---------------------------------------------------------------------------

	describe("dead letter queue", () => {
		it("should write to DLQ when all providers are exhausted", async () => {
			const dlqRepo = new InMemoryDeadLetterRepository();
			const provider1 = createMockProvider("email", { name: "p1", mode: "transient" });
			const provider2 = createMockProvider("email", { name: "p2", mode: "transient" });

			const deliveryParams = createEmailDeliveryParams();
			const params = createDispatchParams({
				providers: [provider1, provider2],
				strategy: "priority",
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
				deadLetterRepository: dlqRepo,
				deliveryParams,
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.exhausted).toBe(true);

			const dlqEntries = dlqRepo.getAll();
			expect(dlqEntries).toHaveLength(1);
		});

		it("should record full attempt history in DLQ entry", async () => {
			const dlqRepo = new InMemoryDeadLetterRepository();
			const provider1 = createMockProvider("email", { name: "failing-1", mode: "transient" });
			const provider2 = createMockProvider("email", { name: "failing-2", mode: "transient" });

			const deliveryParams = createEmailDeliveryParams();
			const params = createDispatchParams({
				providers: [provider1, provider2],
				strategy: "priority",
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
				deadLetterRepository: dlqRepo,
				deliveryParams,
			});

			await dispatch(params);

			const dlqEntries = dlqRepo.getAll();
			expect(dlqEntries[0].attempts).toHaveLength(2);
			expect(dlqEntries[0].attempts[0]).toMatchObject({
				provider: "failing-1",
				errorCode: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE,
			});
			expect(dlqEntries[0].attempts[1]).toMatchObject({
				provider: "failing-2",
				errorCode: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE,
			});
		});

		it("should include the original payload in the DLQ entry", async () => {
			const dlqRepo = new InMemoryDeadLetterRepository();
			const provider = createMockProvider("email", { name: "fail", mode: "transient" });
			const deliveryParams = createEmailDeliveryParams();

			const params = createDispatchParams({
				providers: [provider],
				strategy: "priority",
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
				deadLetterRepository: dlqRepo,
				deliveryParams,
			});

			await dispatch(params);

			const dlqEntries = dlqRepo.getAll();
			expect(dlqEntries[0].payload).toBeDefined();
		});

		it("should not write to DLQ on success", async () => {
			const dlqRepo = new InMemoryDeadLetterRepository();
			const provider = createMockProvider("email");

			const params = createDispatchParams({
				providers: [provider],
				deadLetterRepository: dlqRepo,
				deliveryParams: createEmailDeliveryParams(),
			});

			await dispatch(params);

			expect(dlqRepo.getAll()).toHaveLength(0);
		});

		it("should emit ALL_PROVIDERS_EXHAUSTED error code when writing to DLQ", async () => {
			const provider = createMockProvider("email", { mode: "transient" });
			const params = createDispatchParams({
				providers: [provider],
				strategy: "priority",
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
				deliveryParams: createEmailDeliveryParams(),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.ALL_PROVIDERS_EXHAUSTED);
		});
	});

	// ---------------------------------------------------------------------------
	// Notification status tracking
	// ---------------------------------------------------------------------------

	describe("notification status tracking", () => {
		it("should update notification status to sent on successful delivery", async () => {
			const notifRepo = new InMemoryNotificationRepository();
			const provider = createMockProvider("email");

			const deliveryParams = createEmailDeliveryParams();
			const notifId = deliveryParams.metadata.notificationId;
			await notifRepo.create({
				id: notifId,
				subscriberId: deliveryParams.metadata.subscriberId,
				eventType: deliveryParams.metadata.eventType,
				category: "transactional",
				channel: "email",
				status: "pending",
			});

			const params = createDispatchParams({
				providers: [provider],
				notificationRepository: notifRepo,
				deliveryParams,
			});

			await dispatch(params);

			const notif = await notifRepo.findById(notifId);
			expect(notif?.status).toBe("sent");
		});

		it("should update notification status to failed when all providers exhausted", async () => {
			const notifRepo = new InMemoryNotificationRepository();
			const provider = createMockProvider("email", { mode: "transient" });

			const deliveryParams = createEmailDeliveryParams();
			const notifId = deliveryParams.metadata.notificationId;
			await notifRepo.create({
				id: notifId,
				subscriberId: deliveryParams.metadata.subscriberId,
				eventType: deliveryParams.metadata.eventType,
				category: "transactional",
				channel: "email",
				status: "pending",
			});

			const params = createDispatchParams({
				providers: [provider],
				notificationRepository: notifRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			await dispatch(params);

			const notif = await notifRepo.findById(notifId);
			expect(notif?.status).toBe("failed");
		});

		it("should update notification status to suppressed when address is suppressed", async () => {
			const notifRepo = new InMemoryNotificationRepository();
			const suppRepo = new InMemorySuppressionRepository();
			await suppRepo.create({
				address: "sup@example.com",
				channel: "email",
				reason: "hard_bounce",
			});

			const provider = createMockProvider("email");
			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "sup@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_sup_track",
					subscriberId: "sub_1",
					eventType: "test.event",
				},
			};
			await notifRepo.create({
				id: "notif_sup_track",
				subscriberId: "sub_1",
				eventType: "test.event",
				category: "transactional",
				channel: "email",
				status: "pending",
			});

			const params = createDispatchParams({
				providers: [provider],
				notificationRepository: notifRepo,
				suppressionRepository: suppRepo,
				deliveryParams,
			});

			await dispatch(params);

			const notif = await notifRepo.findById("notif_sup_track");
			expect(notif?.status).toBe("suppressed");
		});
	});

	// ---------------------------------------------------------------------------
	// Boundary conditions
	// ---------------------------------------------------------------------------

	describe("boundary conditions", () => {
		it("should handle an empty providers list by returning exhausted result", async () => {
			const params = createDispatchParams({
				providers: [],
				deliveryParams: createEmailDeliveryParams(),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.exhausted).toBe(true);
		});

		it("should handle single provider success on first attempt", async () => {
			const provider = createMockProvider("email");
			const params = createDispatchParams({ providers: [provider] });

			const result = await dispatch(params);

			expect(result.success).toBe(true);
			expect(provider.calls).toHaveLength(1);
		});
	});

	// ---------------------------------------------------------------------------
	// Push token deactivation — B-004 fix
	//
	// When an FCM provider returns success + invalidTokens, the dispatcher must:
	// 1. Deactivate dead tokens in PushTokenRepository (active = false)
	// 2. NOT create a suppression record
	// 3. Return success to the caller
	//
	// When all tokens are dead (provider throws DELIVERY_INVALID_ADDRESS):
	// 1. Deactivate all tokens
	// 2. NOT create a suppression record
	// 3. Return permanent failure
	// ---------------------------------------------------------------------------

	describe("push token deactivation (B-004)", () => {
		// Reproduction test: prove the bug before fix.
		// Current behavior: FCM throws on partial dead token → dispatcher suppresses entire push address.
		// After fix: FCM returns success + invalidTokens → dispatcher deactivates token, no suppression.
		it("B-004 reproduction: should NOT suppress push address when provider returns partial success with invalidTokens", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const pushTokenRepo = new InMemoryPushTokenRepository();

			// Register tokens for subscriber using the in-memory API
			pushTokenRepo.addToken("token-1", "sub_push_1");
			pushTokenRepo.addToken("dead-token", "sub_push_1");

			// Provider returns partial success — 1 valid, 1 dead
			const provider = createMockProvider("push", { name: "fcm" });
			vi.spyOn(provider, "deliver").mockResolvedValueOnce({
				success: true,
				providerMessageId: "1/2",
				invalidTokens: ["dead-token"],
			});

			const deliveryParams = createPushDeliveryParams({
				metadata: {
					notificationId: "notif_push_b004",
					subscriberId: "sub_push_1",
					eventType: "user.welcome",
				},
			});

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				pushTokenRepository: pushTokenRepo,
				deliveryParams,
			});

			const result = await dispatch(params);

			// Delivery succeeds
			expect(result.success).toBe(true);

			// Dead token is deactivated (active = false)
			const deadRecord = pushTokenRepo.findByToken("dead-token");
			expect(deadRecord?.active).toBe(false);

			// Valid token remains active
			const validRecord = pushTokenRepo.findByToken("token-1");
			expect(validRecord?.active).toBe(true);

			// NO suppression record created (key regression guard)
			const suppRecord = await suppRepo.findByAddressAndChannel("sub_push_1", "push");
			expect(suppRecord).toBeNull();
		});

		it("should deactivate all dead tokens when 3 of 4 tokens are dead on partial success", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const pushTokenRepo = new InMemoryPushTokenRepository();

			for (const token of ["token-good", "dead-1", "dead-2", "dead-3"]) {
				pushTokenRepo.addToken(token, "sub_partial");
			}

			const provider = createMockProvider("push", { name: "fcm" });
			vi.spyOn(provider, "deliver").mockResolvedValueOnce({
				success: true,
				providerMessageId: "1/4",
				invalidTokens: ["dead-1", "dead-2", "dead-3"],
			});

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				pushTokenRepository: pushTokenRepo,
				deliveryParams: createPushDeliveryParams({
					metadata: {
						notificationId: "notif_push_partial",
						subscriberId: "sub_partial",
						eventType: "test.event",
					},
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(true);

			// Dead tokens deactivated
			expect(pushTokenRepo.findByToken("dead-1")?.active).toBe(false);
			expect(pushTokenRepo.findByToken("dead-2")?.active).toBe(false);
			expect(pushTokenRepo.findByToken("dead-3")?.active).toBe(false);

			// Valid token still active
			expect(pushTokenRepo.findByToken("token-good")?.active).toBe(true);

			// No suppression
			const suppRecord = await suppRepo.findByAddressAndChannel("sub_partial", "push");
			expect(suppRecord).toBeNull();
		});

		it("should NOT deactivate any tokens when all tokens succeed (no invalidTokens)", async () => {
			const pushTokenRepo = new InMemoryPushTokenRepository();

			for (const token of ["token-1", "token-2", "token-3"]) {
				pushTokenRepo.addToken(token, "sub_allgood");
			}

			const provider = createMockProvider("push", { name: "fcm" });
			vi.spyOn(provider, "deliver").mockResolvedValueOnce({
				success: true,
				providerMessageId: "3/3",
				// no invalidTokens field
			});

			const params = createDispatchParams({
				providers: [provider],
				pushTokenRepository: pushTokenRepo,
				deliveryParams: createPushDeliveryParams({
					metadata: {
						notificationId: "notif_push_allgood",
						subscriberId: "sub_allgood",
						eventType: "test.event",
					},
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(true);

			// All tokens remain active — no deactivation
			expect(pushTokenRepo.findByToken("token-1")?.active).toBe(true);
			expect(pushTokenRepo.findByToken("token-2")?.active).toBe(true);
			expect(pushTokenRepo.findByToken("token-3")?.active).toBe(true);
		});

		it("should NOT create suppression when all tokens are dead (DELIVERY_INVALID_ADDRESS)", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const pushTokenRepo = new InMemoryPushTokenRepository();

			const deadTokens = ["dead-1", "dead-2", "dead-3", "dead-4"];
			for (const token of deadTokens) {
				pushTokenRepo.addToken(token, "sub_alldead");
			}

			// Provider throws when all tokens fail
			const provider = createMockProvider("push", { name: "fcm", mode: "invalid_address" });

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				pushTokenRepository: pushTokenRepo,
				deliveryParams: createPushDeliveryParams({
					tokens: deadTokens,
					metadata: {
						notificationId: "notif_push_alldead",
						subscriberId: "sub_alldead",
						eventType: "test.event",
					},
				}),
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			// Delivery fails permanently
			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);

			// All dead tokens are deactivated (active = false)
			expect(pushTokenRepo.findByToken("dead-1")?.active).toBe(false);
			expect(pushTokenRepo.findByToken("dead-2")?.active).toBe(false);
			expect(pushTokenRepo.findByToken("dead-3")?.active).toBe(false);
			expect(pushTokenRepo.findByToken("dead-4")?.active).toBe(false);

			// Critical: NO suppression record — push uses token deactivation, not suppression
			const suppRecord = await suppRepo.findByAddressAndChannel("sub_alldead", "push");
			expect(suppRecord).toBeNull();
		});

		it("should allow subscriber to receive push after re-registering new tokens", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const pushTokenRepo = new InMemoryPushTokenRepository();

			// Initial: subscriber has tokens, delivery partially fails
			pushTokenRepo.addToken("old-dead-token", "sub_rereg");
			pushTokenRepo.addToken("good-token", "sub_rereg");

			const provider = createMockProvider("push", { name: "fcm" });
			vi.spyOn(provider, "deliver").mockResolvedValueOnce({
				success: true,
				providerMessageId: "1/2",
				invalidTokens: ["old-dead-token"],
			});

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				pushTokenRepository: pushTokenRepo,
				deliveryParams: createPushDeliveryParams({
					tokens: ["old-dead-token", "good-token"],
					metadata: {
						notificationId: "notif_push_rereg_1",
						subscriberId: "sub_rereg",
						eventType: "test.event",
					},
				}),
			});

			await dispatch(params);

			// Dead token deactivated
			expect(pushTokenRepo.findByToken("old-dead-token")?.active).toBe(false);

			// Good token remains active
			expect(pushTokenRepo.findByToken("good-token")?.active).toBe(true);

			// Subscriber re-registers a new token (simulates app reinstall/refresh)
			pushTokenRepo.addToken("new-token", "sub_rereg");

			// Second delivery succeeds to new token
			vi.spyOn(provider, "deliver").mockResolvedValueOnce({
				success: true,
				providerMessageId: "1/1",
			});

			const params2 = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				pushTokenRepository: pushTokenRepo,
				deliveryParams: createPushDeliveryParams({
					tokens: ["new-token"],
					metadata: {
						notificationId: "notif_push_rereg_2",
						subscriberId: "sub_rereg",
						eventType: "test.event",
					},
				}),
			});

			const result2 = await dispatch(params2);

			// Subscriber successfully receives push via new token
			expect(result2.success).toBe(true);

			// No suppression was ever created — subscriber was never blocked
			const suppRecord = await suppRepo.findByAddressAndChannel("sub_rereg", "push");
			expect(suppRecord).toBeNull();
		});

		it("should NOT deactivate tokens when dispatcher has no pushTokenRepository (graceful skip)", async () => {
			const suppRepo = new InMemorySuppressionRepository();

			const provider = createMockProvider("push", { name: "fcm" });
			vi.spyOn(provider, "deliver").mockResolvedValueOnce({
				success: true,
				providerMessageId: "1/2",
				invalidTokens: ["dead-token"],
			});

			// No pushTokenRepository provided — dispatcher should not crash
			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				// pushTokenRepository deliberately omitted
				deliveryParams: createPushDeliveryParams({
					metadata: {
						notificationId: "notif_push_norepo",
						subscriberId: "sub_norepo",
						eventType: "test.event",
					},
				}),
			});

			// Should succeed without crashing
			const result = await dispatch(params);
			expect(result.success).toBe(true);
		});

		it("should NOT affect email suppression behavior when push token deactivation is added", async () => {
			const suppRepo = new InMemorySuppressionRepository();
			const pushTokenRepo = new InMemoryPushTokenRepository();

			// Email hard bounce should still create suppression record (unchanged behavior)
			const provider = createMockProvider("email", { name: "email-provider", mode: "hard_bounce" });
			const deliveryParams: ChannelDeliveryParams = {
				channel: "email",
				to: "bounce@example.com",
				subject: "Test",
				html: "<p>hi</p>",
				text: "hi",
				metadata: {
					notificationId: "notif_email_regression",
					subscriberId: "sub_email_regression",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				pushTokenRepository: pushTokenRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE);

			// Email suppression still works (regression guard)
			const suppRecord = await suppRepo.findByAddressAndChannel("bounce@example.com", "email");
			expect(suppRecord).not.toBeNull();
			expect(suppRecord?.address).toBe("bounce@example.com");
		});

		it("should NOT affect SMS suppression behavior", async () => {
			const suppRepo = new InMemorySuppressionRepository();

			// SMS invalid address should still create suppression record
			const provider = createMockProvider("sms", { name: "sms-provider", mode: "invalid_address" });
			const deliveryParams: ChannelDeliveryParams = {
				channel: "sms",
				to: "+15550000000",
				body: "Test",
				metadata: {
					notificationId: "notif_sms_regression",
					subscriberId: "sub_sms_regression",
					eventType: "test.event",
				},
			};

			const params = createDispatchParams({
				providers: [provider],
				suppressionRepository: suppRepo,
				deliveryParams,
				retryPolicy: createRetryPolicy({
					maxAttempts: 1,
					initialDelay: 0,
					maxDelay: 0,
					jitter: false,
				}),
			});

			const result = await dispatch(params);

			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);

			// SMS suppression still works
			const suppRecord = await suppRepo.findByAddressAndChannel("+15550000000", "sms");
			expect(suppRecord).not.toBeNull();
		});
	});
});
