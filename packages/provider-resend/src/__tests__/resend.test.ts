import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { EmailDeliveryParams, ProviderPlugin } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("resend", () => ({
	Resend: vi.fn().mockImplementation(() => ({
		emails: { send: mockSend },
	})),
}));

import { ResendProviderConfigSchema, createResendProvider } from "../index";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const validConfig = { apiKey: "re_test_123", fromAddress: "noreply@example.com" };

const validEmailParams: EmailDeliveryParams = {
	channel: "email",
	to: "user@example.com",
	subject: "Test Subject",
	html: "<p>Hello</p>",
	text: "Hello",
	metadata: {
		notificationId: "notif-001",
		subscriberId: "sub-001",
		eventType: "welcome",
	},
};

/**
 * Build a Resend-style error response.
 *
 * IMPORTANT: The implementation uses a RESEND_ERROR_STATUS lookup table that
 * maps `error.name` → statusCode. The `error` object from the real Resend SDK
 * only has `{ name, message }` — NO `statusCode` field. Use canonical Resend
 * SDK error names:
 *   - "rate_limit_exceeded" → 429 → RATE_LIMITED
 *   - "validation_error" / "missing_required_field" / "invalid_parameter" → 422 → may be DELIVERY_INVALID_ADDRESS
 *   - "invalid_api_Key" / "invalid_from_address" / "validation_error" → 403 → DELIVERY_REJECTED
 *   - "missing_api_key" → 401 → DELIVERY_REJECTED
 *   - "application_error" / "internal_server_error" → 500 → PROVIDER_UNAVAILABLE
 *   - unknown name → 500 (default) → PROVIDER_UNAVAILABLE
 */
function resendError(name: string, message: string) {
	return { data: null, error: { name, message } };
}

beforeEach(() => {
	mockSend.mockReset();
});

// ---------------------------------------------------------------------------
// ResendProviderConfigSchema — Zod validation
// ---------------------------------------------------------------------------

describe("ResendProviderConfigSchema", () => {
	it("validates a complete config with all fields", () => {
		const config = {
			apiKey: "re_abc123",
			fromAddress: "noreply@example.com",
			replyTo: "support@example.com",
		};
		expect(ResendProviderConfigSchema.parse(config)).toEqual(config);
	});

	it("validates config without optional replyTo", () => {
		const config = { apiKey: "re_abc123", fromAddress: "noreply@example.com" };
		expect(ResendProviderConfigSchema.parse(config)).toEqual(config);
	});

	it("rejects empty apiKey", () => {
		expect(() =>
			ResendProviderConfigSchema.parse({ apiKey: "", fromAddress: "noreply@example.com" }),
		).toThrow();
	});

	it("rejects missing apiKey", () => {
		expect(() =>
			ResendProviderConfigSchema.parse({ fromAddress: "noreply@example.com" }),
		).toThrow();
	});

	it("rejects empty fromAddress", () => {
		expect(() => ResendProviderConfigSchema.parse({ apiKey: "re_abc", fromAddress: "" })).toThrow();
	});

	it("rejects missing fromAddress", () => {
		expect(() => ResendProviderConfigSchema.parse({ apiKey: "re_abc" })).toThrow();
	});
});

// ---------------------------------------------------------------------------
// createResendProvider — construction (Zod credential validation)
// ---------------------------------------------------------------------------

describe("createResendProvider", () => {
	it("returns a ProviderPlugin with correct name and channel", () => {
		const provider = createResendProvider(validConfig);
		expect(provider.name).toBe("resend");
		expect(provider.channel).toBe("email");
	});

	it("throws EmitoError CONFIG_INVALID when apiKey is empty", () => {
		try {
			createResendProvider({ apiKey: "", fromAddress: "noreply@example.com" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
			expect((err as EmitoError).isRetryable).toBe(false);
			expect((err as EmitoError).statusCode).toBe(500);
		}
	});

	it("throws EmitoError CONFIG_INVALID when fromAddress is empty", () => {
		try {
			createResendProvider({ apiKey: "re_test_123", fromAddress: "" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("accepts optional replyTo in config", () => {
		const provider = createResendProvider({
			...validConfig,
			replyTo: "support@example.com",
		});
		expect(provider.name).toBe("resend");
	});

	it("does not include apiKey value in CONFIG_INVALID error context", () => {
		try {
			createResendProvider({ apiKey: "", fromAddress: "noreply@example.com" });
			expect.fail("should have thrown");
		} catch (err) {
			const contextStr = JSON.stringify((err as EmitoError).context);
			expect(contextStr).not.toContain("re_test_123");
			expect(contextStr).not.toContain("secret");
			expect(contextStr).not.toContain("token");
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — happy path
// ---------------------------------------------------------------------------

describe("deliver — happy path", () => {
	let provider: ProviderPlugin;

	beforeEach(() => {
		provider = createResendProvider(validConfig);
	});

	it("returns DeliveryResult with providerMessageId on success", async () => {
		mockSend.mockResolvedValueOnce({ data: { id: "msg-resend-001" }, error: null });

		const result = await provider.deliver(validEmailParams);

		expect(result.success).toBe(true);
		expect(result.providerMessageId).toBe("msg-resend-001");
	});

	it("calls resend.emails.send with correct parameters including X-Entity-Ref-ID header", async () => {
		mockSend.mockResolvedValueOnce({ data: { id: "msg-1" }, error: null });

		await provider.deliver(validEmailParams);

		expect(mockSend).toHaveBeenCalledWith(
			expect.objectContaining({
				from: "noreply@example.com",
				to: ["user@example.com"],
				subject: "Test Subject",
				html: "<p>Hello</p>",
				text: "Hello",
				headers: { "X-Entity-Ref-ID": "notif-001" },
			}),
		);
	});

	it("passes replyTo from config when set", async () => {
		const providerWithReplyTo = createResendProvider({
			...validConfig,
			replyTo: "support@example.com",
		});
		mockSend.mockResolvedValueOnce({ data: { id: "msg-002" }, error: null });

		await providerWithReplyTo.deliver(validEmailParams);

		expect(mockSend).toHaveBeenCalledWith(
			expect.objectContaining({ replyTo: "support@example.com" }),
		);
	});

	it("passes replyTo from params when config replyTo is not set", async () => {
		mockSend.mockResolvedValueOnce({ data: { id: "msg-003" }, error: null });

		await provider.deliver({ ...validEmailParams, replyTo: "reply@example.com" });

		expect(mockSend).toHaveBeenCalledWith(
			expect.objectContaining({ replyTo: "reply@example.com" }),
		);
	});

	it("returns success true even when providerMessageId is absent from response", async () => {
		mockSend.mockResolvedValueOnce({ data: null, error: null });

		const result = await provider.deliver(validEmailParams);
		expect(result.success).toBe(true);
		expect(result.providerMessageId).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// deliver — RATE_LIMITED (name: "rate_limit_exceeded" → 429, retryable)
// ---------------------------------------------------------------------------

describe("deliver — RATE_LIMITED (rate_limit_exceeded, retryable)", () => {
	it("throws EmitoError RATE_LIMITED with correct code, isRetryable true, statusCode 429", async () => {
		// "rate_limit_exceeded" → RESEND_ERROR_STATUS → 429 → RATE_LIMITED
		mockSend.mockResolvedValueOnce(resendError("rate_limit_exceeded", "Rate limit exceeded"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
			expect((err as EmitoError).isRetryable).toBe(true);
			expect((err as EmitoError).statusCode).toBe(429);
		}
	});

	it("RATE_LIMITED context includes provider and notificationId but not recipient email", async () => {
		mockSend.mockResolvedValueOnce(resendError("rate_limit_exceeded", "Rate limit exceeded"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			const emitErr = err as EmitoError;
			expect(emitErr.context).toMatchObject({
				provider: "resend",
				notificationId: "notif-001",
			});
			expect(JSON.stringify(emitErr.context)).not.toContain("user@example.com");
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — DELIVERY_INVALID_ADDRESS (validation_error + address keywords, non-retryable)
//
// isInvalidAddressError() checks error.name in {validation_error, missing_required_field,
// invalid_parameter} and then looks for "recipient", "address", or "to"+"invalid" in message.
// "invalid_from_address" is explicitly excluded (it's about the sender, not recipient).
// ---------------------------------------------------------------------------

describe("deliver — DELIVERY_INVALID_ADDRESS (non-retryable)", () => {
	it("throws DELIVERY_INVALID_ADDRESS for validation_error with 'recipient' in message", async () => {
		mockSend.mockResolvedValueOnce(resendError("validation_error", "Invalid recipient address"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_INVALID_ADDRESS for validation_error with 'address' in message", async () => {
		mockSend.mockResolvedValueOnce(resendError("validation_error", "The email address is invalid"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_INVALID_ADDRESS for missing_required_field with 'address' in message", async () => {
		mockSend.mockResolvedValueOnce(
			resendError("missing_required_field", "Missing required address field"),
		);

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
		}
	});

	it("throws DELIVERY_INVALID_ADDRESS for invalid_parameter with 'recipient' in message", async () => {
		mockSend.mockResolvedValueOnce(resendError("invalid_parameter", "Invalid recipient email"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — PROVIDER_UNAVAILABLE (application_error / internal_server_error → 500, retryable)
// ---------------------------------------------------------------------------

describe("deliver — PROVIDER_UNAVAILABLE (5xx error names, retryable)", () => {
	it("throws PROVIDER_UNAVAILABLE for application_error (→ 500)", async () => {
		mockSend.mockResolvedValueOnce(resendError("application_error", "Internal server error"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("throws PROVIDER_UNAVAILABLE for internal_server_error (→ 500)", async () => {
		mockSend.mockResolvedValueOnce(
			resendError("internal_server_error", "Service temporarily unavailable"),
		);

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("treats unknown error names as PROVIDER_UNAVAILABLE (default 500)", async () => {
		// Unknown name → RESEND_ERROR_STATUS lookup returns undefined → defaults to 500
		mockSend.mockResolvedValueOnce(resendError("unknown_future_error", "Something unexpected"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — DELIVERY_REJECTED (4xx non-address errors, non-retryable)
// ---------------------------------------------------------------------------

describe("deliver — DELIVERY_REJECTED (4xx non-address errors, non-retryable)", () => {
	it("throws DELIVERY_REJECTED for invalid_api_Key (→ 403)", async () => {
		// "invalid_api_Key" → 403 → not RATE_LIMITED, not INVALID_ADDRESS, not ≥500 → DELIVERY_REJECTED
		mockSend.mockResolvedValueOnce(resendError("invalid_api_Key", "Forbidden — invalid API key"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_REJECTED for missing_api_key (→ 401)", async () => {
		mockSend.mockResolvedValueOnce(resendError("missing_api_key", "API key is missing"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_REJECTED for invalid_from_address (sender issue, not recipient)", async () => {
		// isInvalidAddressError() explicitly returns false for invalid_from_address
		mockSend.mockResolvedValueOnce(
			resendError("invalid_from_address", "The from address is not verified"),
		);

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_REJECTED for validation_error without address keywords", async () => {
		mockSend.mockResolvedValueOnce(
			resendError("validation_error", "Missing required field: subject"),
		);

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
		}
	});

	it("error context includes provider, channel, notificationId, subscriberId", async () => {
		mockSend.mockResolvedValueOnce(resendError("invalid_api_Key", "Forbidden"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).context).toEqual({
				provider: "resend",
				channel: "email",
				notificationId: "notif-001",
				subscriberId: "sub-001",
			});
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — thrown SDK errors (network failures wrap as PROVIDER_UNAVAILABLE)
// ---------------------------------------------------------------------------

describe("deliver — thrown SDK errors (PROVIDER_UNAVAILABLE, retryable)", () => {
	it("wraps thrown network errors as PROVIDER_UNAVAILABLE with original as cause", async () => {
		mockSend.mockRejectedValueOnce(new Error("fetch failed"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
			expect((err as EmitoError).cause).toBeInstanceOf(Error);
		}
	});

	it("re-throws EmitoError instances without double-wrapping them", async () => {
		// The deliver method short-circuits on `err instanceof EmitoError` before wrapping
		const original = new EmitoError({
			code: "RATE_LIMITED",
			message: "already classified",
			isRetryable: true,
		});
		mockSend.mockRejectedValueOnce(original);

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
		}
	});

	it("wraps non-Error thrown values (strings etc.) as PROVIDER_UNAVAILABLE", async () => {
		mockSend.mockRejectedValueOnce("string error");

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — security: credentials and PII must not appear in error context
// ---------------------------------------------------------------------------

describe("deliver — security: no credentials or PII in error context", () => {
	it("does not include apiKey value in DELIVERY_REJECTED error context", async () => {
		mockSend.mockResolvedValueOnce(resendError("invalid_api_Key", "Forbidden"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			const contextStr = JSON.stringify((err as EmitoError).context);
			expect(contextStr).not.toContain("re_test_123");
			expect(contextStr).not.toContain("apiKey");
			expect(contextStr).not.toContain("secret");
			expect(contextStr).not.toContain("token");
		}
	});

	it("does not include fromAddress (credential) in PROVIDER_UNAVAILABLE context", async () => {
		mockSend.mockRejectedValueOnce(new Error("network down"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(JSON.stringify((err as EmitoError).context)).not.toContain("noreply@example.com");
		}
	});

	it("does not include recipient email address in error context", async () => {
		mockSend.mockResolvedValueOnce(resendError("invalid_api_Key", "Forbidden"));

		const provider = createResendProvider(validConfig);
		try {
			await provider.deliver(validEmailParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(JSON.stringify((err as EmitoError).context)).not.toContain("user@example.com");
		}
	});
});

// ---------------------------------------------------------------------------
// healthCheck
// ---------------------------------------------------------------------------

describe("healthCheck", () => {
	it("returns true when client is configured", async () => {
		const provider = createResendProvider(validConfig);
		const healthy = await provider.healthCheck();
		expect(healthy).toBe(true);
	});
});
