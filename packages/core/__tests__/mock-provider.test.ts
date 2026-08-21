/**
 * Tests for the mock provider factory (createMockProvider).
 *
 * Verifies that mock providers:
 * - Implement the ProviderPlugin interface correctly
 * - Record all calls made to deliver()
 * - Can be configured to succeed (default)
 * - Can be configured to simulate transient errors (isRetryable: true)
 * - Can be configured to simulate permanent errors (isRetryable: false)
 * - Can be configured to simulate rate-limit errors
 *
 * Rules applied (testing standards):
 * - Assert on specific EmitoErrorCode values (rule 1)
 * - Assert on isRetryable for error path tests (rule 2)
 * - Use builders for test data (rule 7)
 * - Assert on call arguments for mock verifications (rule 28)
 * - Use vi.useFakeTimers() for timing tests (rule 22)
 */

import { EMITO_ERROR_CODE } from "@emito/types";
import type { ChannelDeliveryParams, DeliveryMetadata } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockProvider } from "../src/testing/mock-provider";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function createDeliveryMetadata(overrides: Partial<DeliveryMetadata> = {}): DeliveryMetadata {
	return {
		notificationId: "notif_1",
		subscriberId: "sub_1",
		eventType: "user.welcome",
		...overrides,
	};
}

function createEmailDeliveryParams(
	overrides: Partial<ChannelDeliveryParams> = {},
): ChannelDeliveryParams {
	return {
		channel: "email",
		to: "recipient@example.com",
		subject: "Test Subject",
		html: "<p>Hello</p>",
		text: "Hello",
		metadata: createDeliveryMetadata(),
		...overrides,
	} as ChannelDeliveryParams;
}

function createSmsDeliveryParams(): ChannelDeliveryParams {
	return {
		channel: "sms",
		to: "+15550001234",
		body: "Hello from Emito",
		metadata: createDeliveryMetadata(),
	};
}

function createSlackDeliveryParams(): ChannelDeliveryParams {
	return {
		channel: "slack",
		webhookUrl: "https://hooks.slack.com/test",
		blocks: [],
		text: "Hello from Emito",
		metadata: createDeliveryMetadata(),
	};
}

// ---------------------------------------------------------------------------
// ProviderPlugin interface conformance
// ---------------------------------------------------------------------------

describe("createMockProvider", () => {
	describe("interface conformance", () => {
		it("should return an object with name, channel, deliver, and healthCheck", () => {
			const provider = createMockProvider("email");

			expect(typeof provider.name).toBe("string");
			expect(typeof provider.channel).toBe("string");
			expect(typeof provider.deliver).toBe("function");
			expect(typeof provider.healthCheck).toBe("function");
		});

		it("should set channel to the provided channel", () => {
			const emailProvider = createMockProvider("email");
			const smsProvider = createMockProvider("sms");

			expect(emailProvider.channel).toBe("email");
			expect(smsProvider.channel).toBe("sms");
		});

		it("should have a non-empty name", () => {
			const provider = createMockProvider("email");
			expect(provider.name.length).toBeGreaterThan(0);
		});

		it("should support all valid channels", () => {
			const channels = [
				"email",
				"sms",
				"push",
				"inApp",
				"webhook",
				"slack",
				"telegram",
				"discord",
				"whatsapp",
				"webPush",
			] as const;
			for (const channel of channels) {
				const provider = createMockProvider(channel);
				expect(provider.channel).toBe(channel);
			}
		});
	});

	// ---------------------------------------------------------------------------
	// Success scenario (default behavior)
	// ---------------------------------------------------------------------------

	describe("success scenario (default)", () => {
		it("should resolve with success:true by default", async () => {
			const provider = createMockProvider("email");
			const params = createEmailDeliveryParams();

			const result = await provider.deliver(params);

			expect(result).toMatchObject({ success: true });
		});

		it("should return a providerMessageId on success", async () => {
			const provider = createMockProvider("email");
			const params = createEmailDeliveryParams();

			const result = await provider.deliver(params);

			expect(result.providerMessageId).toBeDefined();
			expect(typeof result.providerMessageId).toBe("string");
		});

		it("should resolve healthCheck as true by default", async () => {
			const provider = createMockProvider("email");
			const healthy = await provider.healthCheck();
			expect(healthy).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Call recording
	// ---------------------------------------------------------------------------

	describe("call recording", () => {
		it("should record calls to deliver()", async () => {
			const provider = createMockProvider("email");
			const params = createEmailDeliveryParams();

			await provider.deliver(params);

			expect(provider.calls).toHaveLength(1);
		});

		it("should record all calls to deliver() in order", async () => {
			const provider = createMockProvider("email");
			const params1 = createEmailDeliveryParams({
				metadata: createDeliveryMetadata({ notificationId: "notif_1" }),
			} as Partial<ChannelDeliveryParams>);
			const params2 = createEmailDeliveryParams({
				metadata: createDeliveryMetadata({ notificationId: "notif_2" }),
			} as Partial<ChannelDeliveryParams>);

			await provider.deliver(params1);
			await provider.deliver(params2);

			expect(provider.calls).toHaveLength(2);
			expect(
				(provider.calls[0] as { channel: string; metadata: DeliveryMetadata }).metadata
					.notificationId,
			).toBe("notif_1");
			expect(
				(provider.calls[1] as { channel: string; metadata: DeliveryMetadata }).metadata
					.notificationId,
			).toBe("notif_2");
		});

		it("should start with zero recorded calls", () => {
			const provider = createMockProvider("email");
			expect(provider.calls).toHaveLength(0);
		});

		it("should record the full delivery params for each call", async () => {
			const provider = createMockProvider("email");
			const params = createEmailDeliveryParams();

			await provider.deliver(params);

			expect(provider.calls[0]).toMatchObject({
				channel: "email",
				to: "recipient@example.com",
			});
		});
	});

	// ---------------------------------------------------------------------------
	// Transient error simulation
	// ---------------------------------------------------------------------------

	describe("transient error simulation", () => {
		it("should throw EmitoError with PROVIDER_UNAVAILABLE and isRetryable:true", async () => {
			const provider = createMockProvider("email", { mode: "transient" });
			const params = createEmailDeliveryParams();

			await expect(provider.deliver(params)).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE,
				isRetryable: true,
			});
		});

		it("should still record the call even on transient error", async () => {
			const provider = createMockProvider("email", { mode: "transient" });
			const params = createEmailDeliveryParams();

			await expect(provider.deliver(params)).rejects.toThrow();

			expect(provider.calls).toHaveLength(1);
		});

		it("should have isRetryable:true for transient errors (rule 2)", async () => {
			const provider = createMockProvider("sms", { mode: "transient" });
			const params = createSmsDeliveryParams();

			let caughtError: unknown;
			try {
				await provider.deliver(params);
			} catch (err) {
				caughtError = err;
			}

			expect(caughtError).toMatchObject({ isRetryable: true });
		});
	});

	// ---------------------------------------------------------------------------
	// Permanent error simulation
	// ---------------------------------------------------------------------------

	describe("permanent error simulation", () => {
		it("should throw EmitoError with DELIVERY_REJECTED and isRetryable:false", async () => {
			const provider = createMockProvider("email", { mode: "permanent" });
			const params = createEmailDeliveryParams();

			await expect(provider.deliver(params)).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.DELIVERY_REJECTED,
				isRetryable: false,
			});
		});

		it("should have isRetryable:false for permanent errors (rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "permanent" });
			const params = createEmailDeliveryParams();

			let caughtError: unknown;
			try {
				await provider.deliver(params);
			} catch (err) {
				caughtError = err;
			}

			expect(caughtError).toMatchObject({ isRetryable: false });
		});

		it("should still record the call even on permanent error", async () => {
			const provider = createMockProvider("email", { mode: "permanent" });
			const params = createEmailDeliveryParams();

			await expect(provider.deliver(params)).rejects.toThrow();
			expect(provider.calls).toHaveLength(1);
		});
	});

	// ---------------------------------------------------------------------------
	// Rate-limit error simulation
	// ---------------------------------------------------------------------------

	describe("rate-limit error simulation", () => {
		it("should throw EmitoError with RATE_LIMITED and isRetryable:true", async () => {
			const provider = createMockProvider("email", { mode: "rate-limited" });
			const params = createEmailDeliveryParams();

			await expect(provider.deliver(params)).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.RATE_LIMITED,
				isRetryable: true,
			});
		});

		it("should have isRetryable:true for rate-limited errors (rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "rate-limited" });
			const params = createEmailDeliveryParams();

			let caughtError: unknown;
			try {
				await provider.deliver(params);
			} catch (err) {
				caughtError = err;
			}

			expect(caughtError).toMatchObject({ isRetryable: true });
		});

		it("should still record the call even on rate-limit error", async () => {
			const provider = createMockProvider("email", { mode: "rate-limited" });
			const params = createEmailDeliveryParams();

			await expect(provider.deliver(params)).rejects.toThrow();
			expect(provider.calls).toHaveLength(1);
		});
	});

	// ---------------------------------------------------------------------------
	// Timeout simulation
	// ---------------------------------------------------------------------------

	describe("timeout simulation", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should throw PROVIDER_TIMEOUT with isRetryable:true when configured to timeout", async () => {
			const provider = createMockProvider("email", { mode: "timeout", timeoutMs: 5000 });
			const params = createEmailDeliveryParams();

			const deliverPromise = provider.deliver(params);
			const assertion = expect(deliverPromise).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.PROVIDER_TIMEOUT,
				isRetryable: true,
			});
			await vi.advanceTimersByTimeAsync(5000);
			await assertion;
		});
	});

	// ---------------------------------------------------------------------------
	// Configurable failure count (succeed after N failures)
	// ---------------------------------------------------------------------------

	describe("failTimes option", () => {
		it("should fail a configured number of times then succeed", async () => {
			const provider = createMockProvider("email", { mode: "transient", failTimes: 2 });
			const params = createEmailDeliveryParams();

			// First two calls fail
			await expect(provider.deliver(params)).rejects.toMatchObject({ isRetryable: true });
			await expect(provider.deliver(params)).rejects.toMatchObject({ isRetryable: true });

			// Third call succeeds
			const result = await provider.deliver(params);
			expect(result).toMatchObject({ success: true });
		});

		it("should record all attempts including failed ones", async () => {
			const provider = createMockProvider("email", { mode: "transient", failTimes: 1 });
			const params = createEmailDeliveryParams();

			await expect(provider.deliver(params)).rejects.toThrow();
			await provider.deliver(params);

			expect(provider.calls).toHaveLength(2);
		});
	});

	// ---------------------------------------------------------------------------
	// healthCheck scenarios
	// ---------------------------------------------------------------------------

	describe("healthCheck", () => {
		it("should return false when provider is configured as unhealthy", async () => {
			const provider = createMockProvider("email", { healthy: false });
			const result = await provider.healthCheck();
			expect(result).toBe(false);
		});

		it("should return true by default", async () => {
			const provider = createMockProvider("email");
			const result = await provider.healthCheck();
			expect(result).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Channel-specific params
	// ---------------------------------------------------------------------------

	describe("channel-specific delivery params", () => {
		it("should accept and record slack delivery params", async () => {
			const provider = createMockProvider("slack");
			const params = createSlackDeliveryParams();

			const result = await provider.deliver(params);
			expect(result.success).toBe(true);
			expect(provider.calls).toHaveLength(1);
			expect(provider.calls[0]).toMatchObject({ channel: "slack" });
		});

		it("should accept and record sms delivery params", async () => {
			const provider = createMockProvider("sms");
			const params = createSmsDeliveryParams();

			const result = await provider.deliver(params);
			expect(result.success).toBe(true);
			expect(provider.calls[0]).toMatchObject({ channel: "sms" });
		});
	});

	// ---------------------------------------------------------------------------
	// Reset behavior
	// ---------------------------------------------------------------------------

	describe("reset()", () => {
		it("should clear recorded calls when reset is called", async () => {
			const provider = createMockProvider("email");
			await provider.deliver(createEmailDeliveryParams());
			expect(provider.calls).toHaveLength(1);

			provider.reset();

			expect(provider.calls).toHaveLength(0);
		});
	});

	// ---------------------------------------------------------------------------
	// New address-level error modes (task 1 additions)
	// ---------------------------------------------------------------------------

	describe("hard_bounce mode", () => {
		it("should throw EmitoError with DELIVERY_HARD_BOUNCE and isRetryable:false (rule 1, rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "hard_bounce" });

			await expect(provider.deliver(createEmailDeliveryParams())).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE,
				isRetryable: false,
			});
		});

		it("should still record the call on hard bounce", async () => {
			const provider = createMockProvider("email", { mode: "hard_bounce" });
			await expect(provider.deliver(createEmailDeliveryParams())).rejects.toThrow();
			expect(provider.calls).toHaveLength(1);
		});
	});

	describe("soft_bounce mode", () => {
		it("should throw EmitoError with DELIVERY_SOFT_BOUNCE and isRetryable:true (rule 1, rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "soft_bounce" });

			await expect(provider.deliver(createEmailDeliveryParams())).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.DELIVERY_SOFT_BOUNCE,
				isRetryable: true,
			});
		});

		it("should still record the call on soft bounce", async () => {
			const provider = createMockProvider("email", { mode: "soft_bounce" });
			await expect(provider.deliver(createEmailDeliveryParams())).rejects.toThrow();
			expect(provider.calls).toHaveLength(1);
		});
	});

	describe("spam_complaint mode", () => {
		it("should throw EmitoError with DELIVERY_SPAM_COMPLAINT and isRetryable:false (rule 1, rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "spam_complaint" });

			await expect(provider.deliver(createEmailDeliveryParams())).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT,
				isRetryable: false,
			});
		});

		it("should still record the call on spam complaint", async () => {
			const provider = createMockProvider("email", { mode: "spam_complaint" });
			await expect(provider.deliver(createEmailDeliveryParams())).rejects.toThrow();
			expect(provider.calls).toHaveLength(1);
		});
	});

	describe("invalid_address mode", () => {
		it("should throw EmitoError with DELIVERY_INVALID_ADDRESS and isRetryable:false (rule 1, rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "invalid_address" });

			await expect(provider.deliver(createEmailDeliveryParams())).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS,
				isRetryable: false,
			});
		});

		it("should still record the call on invalid address error", async () => {
			const provider = createMockProvider("email", { mode: "invalid_address" });
			await expect(provider.deliver(createEmailDeliveryParams())).rejects.toThrow();
			expect(provider.calls).toHaveLength(1);
		});
	});

	describe("rejected mode", () => {
		it("should throw EmitoError with DELIVERY_REJECTED and isRetryable:false (rule 1, rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "rejected" });

			await expect(provider.deliver(createEmailDeliveryParams())).rejects.toMatchObject({
				code: EMITO_ERROR_CODE.DELIVERY_REJECTED,
				isRetryable: false,
			});
		});

		it("should behave identically to permanent mode (both map to DELIVERY_REJECTED)", async () => {
			const permanent = createMockProvider("email", { mode: "permanent" });
			const rejected = createMockProvider("email", { mode: "rejected" });

			let permanentError: unknown;
			let rejectedError: unknown;
			try {
				await permanent.deliver(createEmailDeliveryParams());
			} catch (err) {
				permanentError = err;
			}
			try {
				await rejected.deliver(createEmailDeliveryParams());
			} catch (err) {
				rejectedError = err;
			}

			expect(permanentError).toMatchObject({ code: EMITO_ERROR_CODE.DELIVERY_REJECTED });
			expect(rejectedError).toMatchObject({ code: EMITO_ERROR_CODE.DELIVERY_REJECTED });
		});
	});
});
