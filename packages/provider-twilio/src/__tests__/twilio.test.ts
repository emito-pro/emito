import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { SmsDeliveryParams } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("twilio", () => {
	const TwilioMock = vi.fn().mockImplementation(() => ({
		messages: { create: mockCreate },
	}));
	return { default: TwilioMock, Twilio: TwilioMock };
});

import { createTwilioProvider } from "../index";

const validSmsParams: SmsDeliveryParams = {
	channel: "sms",
	to: "+15551234567",
	body: "Your verification code is 123456",
	metadata: {
		notificationId: "notif-001",
		subscriberId: "sub-001",
		eventType: "verification",
	},
};

beforeEach(() => {
	mockCreate.mockReset();
});

describe("createTwilioProvider", () => {
	it("returns a ProviderPlugin with correct name and channel", () => {
		const provider = createTwilioProvider({
			accountSid: "AC_test_123",
			authToken: "auth_test_456",
			fromNumber: "+15559876543",
		});
		expect(provider.name).toBe("twilio");
		expect(provider.channel).toBe("sms");
	});

	it("throws EmitoError CONFIG_INVALID when accountSid is empty", () => {
		try {
			createTwilioProvider({ accountSid: "", authToken: "auth_test", fromNumber: "+15559876543" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
		}
	});

	it("throws EmitoError CONFIG_INVALID when authToken is empty", () => {
		try {
			createTwilioProvider({ accountSid: "AC_test", authToken: "", fromNumber: "+15559876543" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
		}
	});

	it("throws EmitoError CONFIG_INVALID when fromNumber is empty", () => {
		try {
			createTwilioProvider({ accountSid: "AC_test", authToken: "auth_test", fromNumber: "" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
		}
	});
});

describe("deliver", () => {
	function createProvider() {
		return createTwilioProvider({
			accountSid: "AC_test_123",
			authToken: "auth_test_456",
			fromNumber: "+15559876543",
		});
	}

	it("returns DeliveryResult with providerMessageId on success", async () => {
		mockCreate.mockResolvedValueOnce({ sid: "SM_msg_001" });

		const provider = createProvider();
		const result = await provider.deliver(validSmsParams);

		expect(result.success).toBe(true);
		expect(result.providerMessageId).toBe("SM_msg_001");
	});

	it("passes correct params to messages.create", async () => {
		mockCreate.mockResolvedValueOnce({ sid: "SM_msg_002" });

		const provider = createProvider();
		await provider.deliver(validSmsParams);

		expect(mockCreate).toHaveBeenCalledWith({
			body: "Your verification code is 123456",
			to: "+15551234567",
			from: "+15559876543",
		});
	});

	it("throws DELIVERY_INVALID_ADDRESS for error code 21211", async () => {
		const twilioErr = Object.assign(new Error("Invalid 'To' Phone Number"), {
			status: 400,
			code: 21211,
		});
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_INVALID_ADDRESS for error code 21614", async () => {
		const twilioErr = Object.assign(new Error("'To' number is not a valid mobile number"), {
			status: 400,
			code: 21614,
		});
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_SPAM_COMPLAINT for error code 21610", async () => {
		const twilioErr = Object.assign(new Error("Attempt to send to unsubscribed recipient"), {
			status: 400,
			code: 21610,
		});
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws PROVIDER_UNAVAILABLE for error code 30003 (transient)", async () => {
		const twilioErr = Object.assign(new Error("Unreachable destination handset"), {
			status: 400,
			code: 30003,
		});
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("throws DELIVERY_HARD_BOUNCE for error code 30005", async () => {
		const twilioErr = Object.assign(new Error("Unknown destination handset"), {
			status: 400,
			code: 30005,
		});
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws DELIVERY_HARD_BOUNCE for error code 30006", async () => {
		const twilioErr = Object.assign(new Error("Landline or unreachable carrier"), {
			status: 400,
			code: 30006,
		});
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws CONFIG_INVALID for error code 20003", async () => {
		const twilioErr = Object.assign(new Error("Authentication failed"), {
			status: 401,
			code: 20003,
		});
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("throws RATE_LIMITED for HTTP 429", async () => {
		const twilioErr = Object.assign(new Error("Too many requests"), { status: 429, code: 20429 });
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("throws PROVIDER_UNAVAILABLE for HTTP 500+", async () => {
		const twilioErr = Object.assign(new Error("Internal server error"), {
			status: 500,
			code: 20500,
		});
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("throws DELIVERY_REJECTED for other Twilio error codes", async () => {
		const twilioErr = Object.assign(new Error("Some other Twilio error"), {
			status: 400,
			code: 99999,
		});
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("re-throws EmitoError directly if one is thrown from within deliver", async () => {
		const originalError = new EmitoError({
			code: EMITO_ERROR_CODE.PROVIDER_TIMEOUT,
			message: "already an EmitoError",
			isRetryable: true,
		});
		mockCreate.mockRejectedValueOnce(originalError);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBe(originalError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_TIMEOUT);
		}
	});

	it("throws PROVIDER_UNAVAILABLE for network errors (non-Twilio)", async () => {
		mockCreate.mockRejectedValueOnce(new Error("fetch failed"));

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
			expect((err as EmitoError).cause).toBeInstanceOf(Error);
		}
	});

	it("includes correct context in thrown errors", async () => {
		const twilioErr = Object.assign(new Error("Some error"), { status: 400, code: 99999 });
		mockCreate.mockRejectedValueOnce(twilioErr);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			const emitErr = err as EmitoError;
			expect(emitErr.context).toEqual({
				provider: "twilio",
				channel: "sms",
				notificationId: "notif-001",
				subscriberId: "sub-001",
				twilioErrorCode: 99999,
			});
		}
	});
});

describe("healthCheck", () => {
	it("returns true when client is configured", async () => {
		const provider = createTwilioProvider({
			accountSid: "AC_test_123",
			authToken: "auth_test_456",
			fromNumber: "+15559876543",
		});
		const healthy = await provider.healthCheck();
		expect(healthy).toBe(true);
	});
});
