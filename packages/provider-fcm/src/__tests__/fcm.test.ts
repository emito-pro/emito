import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ProviderPlugin, PushDeliveryParams } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("firebase-admin/app", () => ({
	cert: vi.fn().mockReturnValue({
		projectId: "test",
		clientEmail: "test@test.iam.gserviceaccount.com",
		privateKey: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
	}),
	initializeApp: vi.fn().mockReturnValue({}),
}));

vi.mock("firebase-admin/messaging", () => ({
	getMessaging: vi.fn().mockReturnValue({ send: (...args: unknown[]) => mockSend(...args) }),
}));

import { FcmProviderConfigSchema, createFcmProvider } from "../index";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const validConfig = {
	projectId: "test-project",
	clientEmail: "test@test.iam.gserviceaccount.com",
	privateKey: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
};

const validPushParams: PushDeliveryParams = {
	channel: "push",
	tokens: ["token-aaa", "token-bbb"],
	title: "Test Title",
	body: "Test Body",
	data: { eventType: "welcome" },
	metadata: {
		notificationId: "notif-001",
		subscriberId: "sub-001",
		eventType: "welcome",
	},
};

function fcmError(code: string, message: string): Error {
	const err = new Error(message);
	(err as unknown as Record<string, unknown>).code = code;
	return err;
}

beforeEach(() => {
	mockSend.mockReset();
});

// ---------------------------------------------------------------------------
// FcmProviderConfigSchema — Zod validation
// ---------------------------------------------------------------------------

describe("FcmProviderConfigSchema", () => {
	it("validates a complete config", () => {
		expect(FcmProviderConfigSchema.parse(validConfig)).toEqual(validConfig);
	});

	it("rejects empty projectId", () => {
		expect(() => FcmProviderConfigSchema.parse({ ...validConfig, projectId: "" })).toThrow();
	});

	it("rejects missing clientEmail", () => {
		expect(() => FcmProviderConfigSchema.parse({ projectId: "p", privateKey: "k" })).toThrow();
	});

	it("rejects empty privateKey", () => {
		expect(() => FcmProviderConfigSchema.parse({ ...validConfig, privateKey: "" })).toThrow();
	});
});

// ---------------------------------------------------------------------------
// createFcmProvider — construction
// ---------------------------------------------------------------------------

describe("createFcmProvider", () => {
	it("returns a ProviderPlugin with correct name and channel", () => {
		const provider = createFcmProvider(validConfig);
		expect(provider.name).toBe("fcm");
		expect(provider.channel).toBe("push");
	});

	it("throws EmitoError CONFIG_INVALID when projectId is empty", () => {
		try {
			createFcmProvider({ ...validConfig, projectId: "" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
			expect((err as EmitoError).isRetryable).toBe(false);
			expect((err as EmitoError).statusCode).toBe(500);
		}
	});

	it("throws EmitoError CONFIG_INVALID when clientEmail is empty", () => {
		try {
			createFcmProvider({ ...validConfig, clientEmail: "" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
		}
	});

	it("throws EmitoError CONFIG_INVALID when privateKey is empty", () => {
		try {
			createFcmProvider({ ...validConfig, privateKey: "" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
		}
	});

	it("does not include credential values in CONFIG_INVALID error context", () => {
		try {
			createFcmProvider({ ...validConfig, projectId: "" });
			expect.fail("should have thrown");
		} catch (err) {
			const contextStr = JSON.stringify((err as EmitoError).context);
			expect(contextStr).not.toContain("BEGIN PRIVATE KEY");
			expect(contextStr).not.toContain("gserviceaccount.com");
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — happy path
// ---------------------------------------------------------------------------

describe("deliver — happy path", () => {
	let provider: ProviderPlugin;

	beforeEach(() => {
		provider = createFcmProvider(validConfig);
	});

	it("returns success with providerMessageId showing success count", async () => {
		mockSend.mockResolvedValue("projects/test/messages/msg-001");

		const result = await provider.deliver(validPushParams);

		expect(result.success).toBe(true);
		expect(result.providerMessageId).toBe("2/2");
	});

	it("calls messaging.send for each token with correct payload", async () => {
		mockSend.mockResolvedValue("projects/test/messages/msg-001");

		await provider.deliver(validPushParams);

		expect(mockSend).toHaveBeenCalledTimes(2);
		expect(mockSend).toHaveBeenCalledWith({
			token: "token-aaa",
			notification: { title: "Test Title", body: "Test Body" },
			data: { eventType: "welcome" },
		});
		expect(mockSend).toHaveBeenCalledWith({
			token: "token-bbb",
			notification: { title: "Test Title", body: "Test Body" },
			data: { eventType: "welcome" },
		});
	});

	it("returns success for empty tokens array without calling send", async () => {
		const result = await provider.deliver({ ...validPushParams, tokens: [] });

		expect(result.success).toBe(true);
		expect(mockSend).not.toHaveBeenCalled();
	});

	it("returns success when at least one token succeeds and no suppressable errors occurred", async () => {
		mockSend
			.mockResolvedValueOnce("projects/test/messages/msg-001")
			.mockRejectedValueOnce(fcmError("messaging/unavailable", "Transient error"));

		const result = await provider.deliver(validPushParams);

		expect(result.success).toBe(true);
		expect(result.providerMessageId).toBe("1/2");
	});

	it("returns success with invalidTokens when 1 of 2 tokens is dead (partial success)", async () => {
		mockSend
			.mockResolvedValueOnce("projects/test/messages/msg-001")
			.mockRejectedValueOnce(
				fcmError("messaging/registration-token-not-registered", "Token not registered"),
			);

		const result = await provider.deliver(validPushParams);

		expect(result.success).toBe(true);
		expect(result.providerMessageId).toBe("1/2");
		expect(result.invalidTokens).toEqual(["token-bbb"]);
	});

	it("returns invalidTokens for invalid-registration-token error code", async () => {
		mockSend
			.mockResolvedValueOnce("projects/test/messages/msg-001")
			.mockRejectedValueOnce(
				fcmError("messaging/invalid-registration-token", "Invalid registration token"),
			);

		const result = await provider.deliver(validPushParams);

		expect(result.success).toBe(true);
		expect(result.invalidTokens).toEqual(["token-bbb"]);
	});

	it("returns invalidTokens only for dead tokens — non-dead failures are not included", async () => {
		mockSend
			.mockResolvedValueOnce("projects/test/messages/msg-001")
			.mockRejectedValueOnce(fcmError("messaging/server-unavailable", "Transient error"));

		const result = await provider.deliver(validPushParams);

		expect(result.success).toBe(true);
		// Transient error is not a dead token — invalidTokens should be empty or absent
		expect(result.invalidTokens ?? []).toHaveLength(0);
	});

	it("returns empty invalidTokens when all tokens succeed", async () => {
		mockSend.mockResolvedValue("projects/test/messages/msg-001");

		const result = await provider.deliver(validPushParams);

		expect(result.success).toBe(true);
		expect(result.invalidTokens ?? []).toHaveLength(0);
	});

	it("sends without data field when not provided", async () => {
		mockSend.mockResolvedValue("msg-001");

		const params: PushDeliveryParams = {
			...validPushParams,
			tokens: ["token-aaa"],
			data: undefined,
		};
		await provider.deliver(params);

		expect(mockSend).toHaveBeenCalledWith({
			token: "token-aaa",
			notification: { title: "Test Title", body: "Test Body" },
			data: undefined,
		});
	});
});

// ---------------------------------------------------------------------------
// Reproduction test — B-004: FCM dead token suppression bug
//
// This test documents the original bug behavior and proves the fix.
// Before fix: FCM threw DELIVERY_INVALID_ADDRESS on any dead token, causing
// the dispatcher to create a suppression record and block ALL push delivery.
// After fix: FCM returns success + invalidTokens, no suppression occurs.
// ---------------------------------------------------------------------------

describe("deliver — partial success with dead token", () => {
	it("should return success (not throw) when 3 of 4 tokens succeed and 1 is dead", async () => {
		// This is the core bug scenario: 3 valid + 1 dead token.
		// Before fix: threw DELIVERY_INVALID_ADDRESS → dispatcher suppresses entire push address.
		// After fix: returns { success: true, invalidTokens: ["dead-token"] }.
		const provider = createFcmProvider(validConfig);
		const params: PushDeliveryParams = {
			...validPushParams,
			tokens: ["token-1", "token-2", "token-3", "dead-token"],
		};

		mockSend
			.mockResolvedValueOnce("msg-1")
			.mockResolvedValueOnce("msg-2")
			.mockResolvedValueOnce("msg-3")
			.mockRejectedValueOnce(
				fcmError("messaging/registration-token-not-registered", "Token not registered"),
			);

		const result = await provider.deliver(params);

		expect(result.success).toBe(true);
		expect(result.providerMessageId).toBe("3/4");
		expect(result.invalidTokens).toEqual(["dead-token"]);
	});

	it("should NOT suppress subscriber when partial success — invalidTokens returned instead", async () => {
		// Verifies that the result shape allows the dispatcher to deactivate individual tokens
		// rather than creating a suppression record.
		const provider = createFcmProvider(validConfig);
		const params: PushDeliveryParams = {
			...validPushParams,
			tokens: ["good-token", "bad-token"],
		};

		mockSend
			.mockResolvedValueOnce("msg-1")
			.mockRejectedValueOnce(
				fcmError("messaging/registration-token-not-registered", "Token not registered"),
			);

		// Should NOT throw — suppression only happens when dispatch receives an error
		const result = await provider.deliver(params);

		expect(result.success).toBe(true);
		expect(result.invalidTokens).toContain("bad-token");
		expect(result.invalidTokens).not.toContain("good-token");
	});
});

// ---------------------------------------------------------------------------
// deliver — all tokens dead (DELIVERY_INVALID_ADDRESS, no suppression)
// ---------------------------------------------------------------------------

describe("deliver — all tokens dead (0 success)", () => {
	it("throws DELIVERY_INVALID_ADDRESS when all tokens are dead", async () => {
		const provider = createFcmProvider(validConfig);
		const params: PushDeliveryParams = {
			...validPushParams,
			tokens: ["dead-1", "dead-2", "dead-3", "dead-4"],
		};

		mockSend.mockRejectedValue(
			fcmError("messaging/registration-token-not-registered", "Token not registered"),
		);

		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_INVALID_ADDRESS for single dead token", async () => {
		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["bad-token"] };

		mockSend.mockRejectedValue(
			fcmError("messaging/registration-token-not-registered", "Token not registered"),
		);

		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_INVALID_ADDRESS for invalid-registration-token when all fail", async () => {
		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["bad-token"] };

		mockSend.mockRejectedValue(
			fcmError("messaging/invalid-registration-token", "Invalid registration token"),
		);

		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — RATE_LIMITED (retryable)
// ---------------------------------------------------------------------------

describe("deliver — RATE_LIMITED (retryable)", () => {
	it("throws RATE_LIMITED for too-many-requests", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/too-many-requests", "Quota exceeded"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
			expect((err as EmitoError).isRetryable).toBe(true);
			expect((err as EmitoError).statusCode).toBe(429);
		}
	});

	it("throws RATE_LIMITED for message-rate-exceeded", async () => {
		mockSend.mockRejectedValue(
			fcmError("messaging/message-rate-exceeded", "Message rate exceeded"),
		);

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("throws RATE_LIMITED for topics-message-rate-exceeded", async () => {
		mockSend.mockRejectedValue(
			fcmError("messaging/topics-message-rate-exceeded", "Topic rate exceeded"),
		);

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("RATE_LIMITED context includes provider and fcmErrorCode", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/too-many-requests", "Quota exceeded"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			const emitErr = err as EmitoError;
			expect(emitErr.context).toMatchObject({
				provider: "fcm",
				channel: "push",
				notificationId: "notif-001",
				fcmErrorCode: "messaging/too-many-requests",
			});
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — PROVIDER_UNAVAILABLE (transient, retryable)
// ---------------------------------------------------------------------------

describe("deliver — PROVIDER_UNAVAILABLE (transient, retryable)", () => {
	it("throws PROVIDER_UNAVAILABLE for messaging/server-unavailable", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/server-unavailable", "FCM service unavailable"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("throws PROVIDER_UNAVAILABLE for messaging/internal-error", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/internal-error", "Internal server error"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("throws PROVIDER_UNAVAILABLE for messaging/unknown-error", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/unknown-error", "Unknown FCM error"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — DELIVERY_REJECTED (invalid argument, non-retryable)
// ---------------------------------------------------------------------------

describe("deliver — DELIVERY_REJECTED (non-retryable)", () => {
	it("throws DELIVERY_REJECTED for messaging/invalid-argument", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/invalid-argument", "Invalid message payload"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_REJECTED for messaging/mismatched-credential", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/mismatched-credential", "Credential mismatch"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_REJECTED for unknown FCM error codes (default-safe)", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/unknown-future-code", "Something new"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("error context includes provider, channel, notificationId, subscriberId, fcmErrorCode", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/invalid-argument", "Bad payload"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).context).toEqual({
				provider: "fcm",
				channel: "push",
				notificationId: "notif-001",
				subscriberId: "sub-001",
				fcmErrorCode: "messaging/invalid-argument",
			});
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — thrown non-FCM errors (network failures → PROVIDER_UNAVAILABLE)
// ---------------------------------------------------------------------------

describe("deliver — thrown non-FCM errors (PROVIDER_UNAVAILABLE, retryable)", () => {
	it("wraps thrown network errors as PROVIDER_UNAVAILABLE with original as cause", async () => {
		mockSend.mockRejectedValue(new TypeError("fetch failed"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
			expect((err as EmitoError).cause).toBeInstanceOf(TypeError);
		}
	});

	it("wraps non-Error thrown values as PROVIDER_UNAVAILABLE", async () => {
		mockSend.mockRejectedValue("string error");

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — security: no credentials or PII in error context
// ---------------------------------------------------------------------------

describe("deliver — security: no credentials or PII in error context", () => {
	it("does not include privateKey in error context", async () => {
		mockSend.mockRejectedValue(fcmError("messaging/invalid-argument", "Bad payload"));

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["token-aaa"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			const contextStr = JSON.stringify((err as EmitoError).context);
			expect(contextStr).not.toContain("BEGIN PRIVATE KEY");
			expect(contextStr).not.toContain("privateKey");
		}
	});

	it("does not include device tokens in error context", async () => {
		mockSend.mockRejectedValue(
			fcmError("messaging/registration-token-not-registered", "Token not registered"),
		);

		const provider = createFcmProvider(validConfig);
		const params = { ...validPushParams, tokens: ["secret-device-token"] };
		try {
			await provider.deliver(params);
			expect.fail("should have thrown");
		} catch (err) {
			const contextStr = JSON.stringify((err as EmitoError).context);
			expect(contextStr).not.toContain("secret-device-token");
		}
	});
});

// ---------------------------------------------------------------------------
// healthCheck
// ---------------------------------------------------------------------------

describe("healthCheck", () => {
	it("returns true when messaging is configured", async () => {
		const provider = createFcmProvider(validConfig);
		const healthy = await provider.healthCheck();
		expect(healthy).toBe(true);
	});
});
