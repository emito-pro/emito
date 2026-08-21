import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { SmsDeliveryParams } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSmsapiProvider } from "../index";

const validSmsParams: SmsDeliveryParams = {
	channel: "sms",
	to: "+48123456789",
	body: "hej",
	metadata: {
		notificationId: "notif-001",
		subscriberId: "sub-001",
		eventType: "verification",
	},
};

const validConfig = {
	accessToken: "token_123",
	from: "TestSender",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});

describe("createSmsapiProvider", () => {
	it("returns a ProviderPlugin with correct name and channel", () => {
		const provider = createSmsapiProvider(validConfig);
		expect(provider.name).toBe("smsapi");
		expect(provider.channel).toBe("sms");
	});

	it("throws EmitoError CONFIG_INVALID when accessToken is missing", () => {
		try {
			createSmsapiProvider({ from: "X" } as never);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
		}
	});

	it("throws EmitoError CONFIG_INVALID when from is empty", () => {
		try {
			createSmsapiProvider({ accessToken: "token", from: "" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
		}
	});
});

describe("deliver", () => {
	function createProvider() {
		return createSmsapiProvider(validConfig);
	}

	function mockFetchResponse(status: number, json: unknown) {
		fetchMock.mockResolvedValueOnce({
			ok: status >= 200 && status < 300,
			status,
			json: async () => json,
		});
	}

	it("returns DeliveryResult with providerMessageId on success", async () => {
		mockFetchResponse(200, {
			count: 1,
			list: [{ id: "msg_1", points: 1, number: "48123456789", status: "QUEUED" }],
		});

		const provider = createProvider();
		const result = await provider.deliver(validSmsParams);

		expect(result).toEqual({ success: true, providerMessageId: "msg_1" });
	});

	it("sends correct request to SMSAPI", async () => {
		mockFetchResponse(200, { count: 1, list: [{ id: "msg_2" }] });

		const provider = createProvider();
		await provider.deliver(validSmsParams);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(calledUrl).toBe("https://api.smsapi.pl/sms.do");
		expect(calledInit.method).toBe("POST");
		expect(calledInit.headers).toEqual({
			Authorization: "Bearer token_123",
			"Content-Type": "application/x-www-form-urlencoded",
		});

		const sentBody = calledInit.body as URLSearchParams;
		expect(sentBody.get("to")).toBe("48123456789");
		expect(sentBody.get("from")).toBe("TestSender");
		expect(sentBody.get("message")).toBe("hej");
		expect(sentBody.get("format")).toBe("json");
		expect(sentBody.get("encoding")).toBe("utf-8");
	});

	it("uses config.endpoint when provided", async () => {
		mockFetchResponse(200, { count: 1, list: [{ id: "msg_3" }] });

		const provider = createSmsapiProvider({
			...validConfig,
			endpoint: "https://custom.example/sms.do",
		});
		await provider.deliver(validSmsParams);

		const [calledUrl] = fetchMock.mock.calls[0] as [string];
		expect(calledUrl).toBe("https://custom.example/sms.do");
	});

	it("throws DELIVERY_INVALID_ADDRESS for error code 13", async () => {
		mockFetchResponse(200, { error: 13, message: "invalid number" });

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

	it("throws DELIVERY_INVALID_ADDRESS for error code 14", async () => {
		mockFetchResponse(200, { error: 14, message: "number absent" });

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
		}
	});

	it("throws CONFIG_INVALID for auth error codes 101/102", async () => {
		mockFetchResponse(200, { error: 101, message: "invalid access token" });

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

	it("throws PROVIDER_UNAVAILABLE for transient error codes 8/201", async () => {
		mockFetchResponse(200, { error: 8, message: "internal error" });

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

	it("throws PROVIDER_UNAVAILABLE for HTTP 500+", async () => {
		mockFetchResponse(500, { error: 999, message: "server error" });

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

	it("throws RATE_LIMITED for HTTP 429", async () => {
		mockFetchResponse(429, { error: 999, message: "too many requests" });

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

	it("throws DELIVERY_REJECTED for other error codes", async () => {
		mockFetchResponse(200, { error: 999, message: "some other error" });

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

	it("throws PROVIDER_UNAVAILABLE for HTTP 500+ with no error field in the body", async () => {
		mockFetchResponse(502, { unexpected: "shape" });

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

	it("throws DELIVERY_REJECTED for a non-ok, non-5xx response with no error field", async () => {
		mockFetchResponse(400, { unexpected: "shape" });

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

	it("throws DELIVERY_REJECTED for an ok response with an unrecognized shape", async () => {
		mockFetchResponse(200, { unexpected: "shape" });

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
		}
	});

	it("re-throws EmitoError directly if one is thrown from within deliver", async () => {
		const originalError = new EmitoError({
			code: EMITO_ERROR_CODE.PROVIDER_TIMEOUT,
			message: "already an EmitoError",
			isRetryable: true,
		});
		fetchMock.mockRejectedValueOnce(originalError);

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBe(originalError);
		}
	});

	it("throws PROVIDER_UNAVAILABLE for network errors", async () => {
		fetchMock.mockRejectedValueOnce(new Error("fetch failed"));

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
		mockFetchResponse(200, { error: 999, message: "some error" });

		const provider = createProvider();
		try {
			await provider.deliver(validSmsParams);
			expect.fail("should have thrown");
		} catch (err) {
			const emitErr = err as EmitoError;
			expect(emitErr.context).toEqual({
				provider: "smsapi",
				channel: "sms",
				notificationId: "notif-001",
				subscriberId: "sub-001",
				smsapiError: 999,
			});
		}
	});
});

describe("healthCheck", () => {
	it("returns true when config is validated", async () => {
		const provider = createSmsapiProvider(validConfig);
		const healthy = await provider.healthCheck();
		expect(healthy).toBe(true);
	});
});
