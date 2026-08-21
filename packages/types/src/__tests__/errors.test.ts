import { describe, expect, it } from "vitest";
import {
	EMITO_ERROR_CODE,
	ERROR_STATUS_CODES,
	EmitoError,
	type EmitoErrorCode,
	RETRYABLE_CODES,
	RETRYABLE_RECORD,
	SUPPRESSABLE_ERROR_CODES,
	SUPPRESSABLE_RECORD,
} from "../errors";

describe("EmitoError", () => {
	it("constructs with required fields and derives statusCode and isRetryable", () => {
		const err = new EmitoError({
			code: "PROVIDER_TIMEOUT",
			message: "SendGrid timed out",
		});

		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(EmitoError);
		expect(err.name).toBe("EmitoError");
		expect(err.code).toBe("PROVIDER_TIMEOUT");
		expect(err.message).toBe("SendGrid timed out");
		expect(err.statusCode).toBe(504);
		expect(err.isRetryable).toBe(true);
	});

	it("allows explicit statusCode and isRetryable overrides", () => {
		const err = new EmitoError({
			code: "DELIVERY_FAILED",
			message: "custom",
			statusCode: 500,
			isRetryable: false,
		});

		expect(err.statusCode).toBe(500);
		expect(err.isRetryable).toBe(false);
	});

	it("supports error chaining via cause", () => {
		const cause = new Error("original");
		const err = new EmitoError({
			code: "CONFIG_INVALID",
			message: "bad config",
			cause,
		});

		expect(err.cause).toBe(cause);
	});

	it("stores context metadata", () => {
		const err = new EmitoError({
			code: "DELIVERY_FAILED",
			message: "failed",
			context: { provider: "sendgrid", channel: "email" },
		});

		expect(err.context).toEqual({ provider: "sendgrid", channel: "email" });
	});

	it("defaults context to empty object", () => {
		const err = new EmitoError({
			code: "CONFIG_INVALID",
			message: "test",
		});

		expect(err.context).toEqual({});
	});

	it("has immutable code, statusCode, isRetryable, and context", () => {
		const err = new EmitoError({
			code: "RATE_LIMITED",
			message: "too many requests",
		});

		expect(() => {
			(err as { code: string }).code = "CONFIG_INVALID";
		}).toThrow(TypeError);
		expect(() => {
			(err as { statusCode: number }).statusCode = 500;
		}).toThrow(TypeError);
		expect(() => {
			(err as { isRetryable: boolean }).isRetryable = false;
		}).toThrow(TypeError);
		expect(() => {
			(err as { context: Record<string, unknown> }).context = {};
		}).toThrow(TypeError);
	});

	describe("fromUnknown", () => {
		it("wraps an Error instance", () => {
			const original = new Error("network failure");
			const err = EmitoError.fromUnknown(original, {
				code: "PROVIDER_UNAVAILABLE",
			});

			expect(err.message).toBe("network failure");
			expect(err.cause).toBe(original);
			expect(err.code).toBe("PROVIDER_UNAVAILABLE");
		});

		it("wraps a non-Error value", () => {
			const err = EmitoError.fromUnknown("string error", {
				code: "DELIVERY_FAILED",
			});

			expect(err.message).toBe("Unknown error");
			expect(err.cause).toBeUndefined();
		});

		it("uses provided message over cause message", () => {
			const original = new Error("original msg");
			const err = EmitoError.fromUnknown(original, {
				code: "DELIVERY_FAILED",
				message: "custom message",
			});

			expect(err.message).toBe("custom message");
		});
	});
});

describe("EMITO_ERROR_CODE", () => {
	it("is a frozen object with exactly 48 codes", () => {
		expect(Object.isFrozen(EMITO_ERROR_CODE)).toBe(true);
		expect(Object.keys(EMITO_ERROR_CODE)).toHaveLength(48);
	});

	it("does not contain DELIVERY_PERMANENT (renamed to DELIVERY_REJECTED)", () => {
		expect("DELIVERY_PERMANENT" in EMITO_ERROR_CODE).toBe(false);
	});

	it("contains all 4 new delivery error codes", () => {
		expect(EMITO_ERROR_CODE.DELIVERY_REJECTED).toBe("DELIVERY_REJECTED");
		expect(EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE).toBe("DELIVERY_HARD_BOUNCE");
		expect(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS).toBe("DELIVERY_INVALID_ADDRESS");
		expect(EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT).toBe("DELIVERY_SPAM_COMPLAINT");
		expect(EMITO_ERROR_CODE.DELIVERY_SOFT_BOUNCE).toBe("DELIVERY_SOFT_BOUNCE");
	});

	it("each key maps to itself as value", () => {
		for (const [key, value] of Object.entries(EMITO_ERROR_CODE)) {
			expect(key).toBe(value);
		}
	});
});

describe("ERROR_STATUS_CODES", () => {
	const ALL_CODES: EmitoErrorCode[] = [
		"CONFIG_INVALID",
		"CONFIG_MISSING_PROVIDER",
		"SUBSCRIBER_NOT_FOUND",
		"SUBSCRIBER_ERASED",
		"CONSENT_REQUIRED",
		"CATEGORY_BLOCKED",
		"PREFERENCE_NOT_FOUND",
		"PREFERENCE_BLOCKED",
		"DELIVERY_FAILED",
		"DELIVERY_REJECTED",
		"DELIVERY_HARD_BOUNCE",
		"DELIVERY_INVALID_ADDRESS",
		"DELIVERY_SPAM_COMPLAINT",
		"DELIVERY_SOFT_BOUNCE",
		"ALL_PROVIDERS_EXHAUSTED",
		"RATE_LIMITED",
		"PROVIDER_UNAVAILABLE",
		"PROVIDER_TIMEOUT",
		"CIRCUIT_BREAKER_OPEN",
		"TEMPLATE_NOT_FOUND",
		"TEMPLATE_RENDER_FAILED",
		"WEBHOOK_SIGNING_FAILED",
		"WEBHOOK_ENDPOINT_DISABLED",
		"WEBHOOK_DELIVERY_FAILED",
		"WEBHOOK_SIGNATURE_INVALID",
		"WEBHOOK_PARSE_FAILED",
		"WEBHOOK_PROVIDER_NOT_FOUND",
		"DIGEST_FLUSH_FAILED",
		"TRANSPORT_CONNECTION_FAILED",
		"TRANSPORT_DISCONNECTED",
		"SUPPRESSED_ADDRESS",
		"ERASURE_FAILED",
		"AUTH_INVALID_TOKEN",
		"AUTH_MISSING_TOKEN",
		"AUTH_INSUFFICIENT_ROLE",
		"AUTH_INVALID_API_KEY",
		"CURSOR_INVALID",
		"ROUTE_NOT_FOUND",
		"DEAD_LETTER_NOT_FOUND",
		"SUPPRESSION_NOT_FOUND",
		"INTEGRATION_NOT_FOUND",
		"INBOX_NOT_FOUND",
		"RESOURCE_NOT_FOUND",
		"RESOURCE_CONFLICT",
		"REQUEST_TIMEOUT",
		"PAYLOAD_TOO_LARGE",
		"VALIDATION_ERROR",
		"INTERNAL_ERROR",
	];

	it("has exactly 48 error codes", () => {
		expect(Object.keys(ERROR_STATUS_CODES)).toHaveLength(48);
	});

	it("maps every code to a valid HTTP status", () => {
		for (const code of ALL_CODES) {
			const status = ERROR_STATUS_CODES[code];
			expect(status).toBeTypeOf("number");
			expect(status).toBeGreaterThanOrEqual(400);
			expect(status).toBeLessThan(600);
		}
	});

	it.each([
		["CONFIG_INVALID", 500],
		["CONFIG_MISSING_PROVIDER", 500],
		["SUBSCRIBER_NOT_FOUND", 404],
		["SUBSCRIBER_ERASED", 410],
		["CONSENT_REQUIRED", 403],
		["CATEGORY_BLOCKED", 403],
		["PREFERENCE_NOT_FOUND", 404],
		["PREFERENCE_BLOCKED", 403],
		["DELIVERY_FAILED", 502],
		["DELIVERY_REJECTED", 502],
		["DELIVERY_HARD_BOUNCE", 502],
		["DELIVERY_INVALID_ADDRESS", 502],
		["DELIVERY_SPAM_COMPLAINT", 502],
		["DELIVERY_SOFT_BOUNCE", 502],
		["ALL_PROVIDERS_EXHAUSTED", 503],
		["RATE_LIMITED", 429],
		["PROVIDER_UNAVAILABLE", 503],
		["PROVIDER_TIMEOUT", 504],
		["CIRCUIT_BREAKER_OPEN", 503],
		["TEMPLATE_NOT_FOUND", 404],
		["TEMPLATE_RENDER_FAILED", 500],
		["WEBHOOK_SIGNING_FAILED", 500],
		["WEBHOOK_ENDPOINT_DISABLED", 422],
		["WEBHOOK_DELIVERY_FAILED", 502],
		["WEBHOOK_SIGNATURE_INVALID", 401],
		["WEBHOOK_PARSE_FAILED", 400],
		["WEBHOOK_PROVIDER_NOT_FOUND", 404],
		["DIGEST_FLUSH_FAILED", 500],
		["TRANSPORT_CONNECTION_FAILED", 503],
		["TRANSPORT_DISCONNECTED", 503],
		["SUPPRESSED_ADDRESS", 422],
		["ERASURE_FAILED", 500],
		["AUTH_INVALID_TOKEN", 401],
		["AUTH_MISSING_TOKEN", 401],
		["AUTH_INSUFFICIENT_ROLE", 403],
		["AUTH_INVALID_API_KEY", 401],
		["REQUEST_TIMEOUT", 408],
		["PAYLOAD_TOO_LARGE", 413],
		["VALIDATION_ERROR", 400],
		["INTERNAL_ERROR", 500],
		["RESOURCE_NOT_FOUND", 404],
	] as [EmitoErrorCode, number][])("%s → %d", (code, expectedStatus) => {
		expect(ERROR_STATUS_CODES[code]).toBe(expectedStatus);
	});
});

describe("RETRYABLE_CODES", () => {
	it("contains exactly 12 retryable codes", () => {
		expect(RETRYABLE_CODES.size).toBe(12);
	});

	it.each([
		"DELIVERY_FAILED",
		"DELIVERY_SOFT_BOUNCE",
		"RATE_LIMITED",
		"PROVIDER_UNAVAILABLE",
		"PROVIDER_TIMEOUT",
		"CIRCUIT_BREAKER_OPEN",
		"WEBHOOK_DELIVERY_FAILED",
		"DIGEST_FLUSH_FAILED",
		"TRANSPORT_CONNECTION_FAILED",
		"TRANSPORT_DISCONNECTED",
		"ERASURE_FAILED",
		"REQUEST_TIMEOUT",
	] as EmitoErrorCode[])("%s is retryable", (code) => {
		expect(RETRYABLE_CODES.has(code)).toBe(true);
	});
});

describe("SUPPRESSABLE_ERROR_CODES", () => {
	it("contains exactly 3 codes (the address-level permanent codes)", () => {
		expect(SUPPRESSABLE_ERROR_CODES.size).toBe(3);
	});

	it("contains DELIVERY_HARD_BOUNCE", () => {
		expect(SUPPRESSABLE_ERROR_CODES.has("DELIVERY_HARD_BOUNCE")).toBe(true);
	});

	it("contains DELIVERY_INVALID_ADDRESS", () => {
		expect(SUPPRESSABLE_ERROR_CODES.has("DELIVERY_INVALID_ADDRESS")).toBe(true);
	});

	it("contains DELIVERY_SPAM_COMPLAINT", () => {
		expect(SUPPRESSABLE_ERROR_CODES.has("DELIVERY_SPAM_COMPLAINT")).toBe(true);
	});

	it("does NOT contain DELIVERY_REJECTED (non-address catch-all must not suppress)", () => {
		expect(SUPPRESSABLE_ERROR_CODES.has("DELIVERY_REJECTED")).toBe(false);
	});

	it("does NOT contain DELIVERY_SOFT_BOUNCE (soft bounces retry, never suppress)", () => {
		expect(SUPPRESSABLE_ERROR_CODES.has("DELIVERY_SOFT_BOUNCE")).toBe(false);
	});

	it("does NOT contain DELIVERY_FAILED (generic failure must not suppress)", () => {
		expect(SUPPRESSABLE_ERROR_CODES.has("DELIVERY_FAILED")).toBe(false);
	});

	it("is a ReadonlySet (iterable)", () => {
		const codes = [...SUPPRESSABLE_ERROR_CODES];
		expect(codes).toHaveLength(3);
	});
});

describe("RETRYABLE_RECORD (exhaustive Record)", () => {
	it("covers every EmitoErrorCode — record has exactly 48 entries", () => {
		expect(Object.keys(RETRYABLE_RECORD)).toHaveLength(48);
	});

	it("every EMITO_ERROR_CODE key is present in the Record", () => {
		for (const code of Object.keys(EMITO_ERROR_CODE) as EmitoErrorCode[]) {
			expect(code in RETRYABLE_RECORD).toBe(true);
		}
	});

	it("all values are booleans", () => {
		for (const value of Object.values(RETRYABLE_RECORD)) {
			expect(typeof value).toBe("boolean");
		}
	});

	it("RETRYABLE_CODES Set is consistent with RETRYABLE_RECORD", () => {
		for (const [code, isRetryable] of Object.entries(RETRYABLE_RECORD) as [
			EmitoErrorCode,
			boolean,
		][]) {
			expect(RETRYABLE_CODES.has(code)).toBe(isRetryable);
		}
	});

	it("DELIVERY_FAILED is true (retryable)", () => {
		expect(RETRYABLE_RECORD.DELIVERY_FAILED).toBe(true);
	});

	it("DELIVERY_REJECTED is false (not retryable)", () => {
		expect(RETRYABLE_RECORD.DELIVERY_REJECTED).toBe(false);
	});

	it("REQUEST_TIMEOUT is true (retryable)", () => {
		expect(RETRYABLE_RECORD.REQUEST_TIMEOUT).toBe(true);
	});
});

describe("SUPPRESSABLE_RECORD (exhaustive Record)", () => {
	it("covers every EmitoErrorCode — record has exactly 48 entries", () => {
		expect(Object.keys(SUPPRESSABLE_RECORD)).toHaveLength(48);
	});

	it("every EMITO_ERROR_CODE key is present in the Record", () => {
		for (const code of Object.keys(EMITO_ERROR_CODE) as EmitoErrorCode[]) {
			expect(code in SUPPRESSABLE_RECORD).toBe(true);
		}
	});

	it("all values are booleans", () => {
		for (const value of Object.values(SUPPRESSABLE_RECORD)) {
			expect(typeof value).toBe("boolean");
		}
	});

	it("SUPPRESSABLE_ERROR_CODES Set is consistent with SUPPRESSABLE_RECORD", () => {
		for (const [code, isSuppressable] of Object.entries(SUPPRESSABLE_RECORD) as [
			EmitoErrorCode,
			boolean,
		][]) {
			expect(SUPPRESSABLE_ERROR_CODES.has(code)).toBe(isSuppressable);
		}
	});

	it("DELIVERY_HARD_BOUNCE is true (suppressable)", () => {
		expect(SUPPRESSABLE_RECORD.DELIVERY_HARD_BOUNCE).toBe(true);
	});

	it("DELIVERY_INVALID_ADDRESS is true (suppressable)", () => {
		expect(SUPPRESSABLE_RECORD.DELIVERY_INVALID_ADDRESS).toBe(true);
	});

	it("DELIVERY_SPAM_COMPLAINT is true (suppressable)", () => {
		expect(SUPPRESSABLE_RECORD.DELIVERY_SPAM_COMPLAINT).toBe(true);
	});

	it("DELIVERY_REJECTED is false (not suppressable)", () => {
		expect(SUPPRESSABLE_RECORD.DELIVERY_REJECTED).toBe(false);
	});

	it("DELIVERY_SOFT_BOUNCE is false (retries, must not suppress)", () => {
		expect(SUPPRESSABLE_RECORD.DELIVERY_SOFT_BOUNCE).toBe(false);
	});
});
