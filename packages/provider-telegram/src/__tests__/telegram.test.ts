import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ProviderPlugin, TelegramDeliveryParams } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramProvider } from "../index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeParams(overrides?: Partial<TelegramDeliveryParams>): TelegramDeliveryParams {
	return {
		channel: "telegram",
		botToken: "123456:ABC-DEF",
		chatId: "789",
		html: "<b>Hello</b> world",
		metadata: {
			notificationId: "notif-001",
			subscriberId: "sub-001",
			eventType: "test.event",
		},
		...overrides,
	};
}

function mockFetch(status: number, body = '{"ok":true}'): typeof globalThis.fetch {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		text: () => Promise.resolve(body),
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// createTelegramProvider — construction
// ---------------------------------------------------------------------------

describe("createTelegramProvider", () => {
	it("should return a provider with name 'telegram' and channel 'telegram'", () => {
		const provider = createTelegramProvider();
		expect(provider.name).toBe("telegram");
		expect(provider.channel).toBe("telegram");
	});

	it("should accept an injected fetchFn for testing", () => {
		const fetchFn = mockFetch(200);
		const provider = createTelegramProvider({ fetchFn });
		expect(provider).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// healthCheck
// ---------------------------------------------------------------------------

describe("healthCheck", () => {
	it("should return true", async () => {
		const provider = createTelegramProvider();
		expect(await provider.healthCheck()).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// deliver — happy path
// ---------------------------------------------------------------------------

describe("deliver — happy path", () => {
	let provider: ProviderPlugin;
	let fetchFn: ReturnType<typeof mockFetch>;

	beforeEach(() => {
		fetchFn = mockFetch(200);
		provider = createTelegramProvider({ fetchFn });
	});

	it("should return success true when Telegram responds with 200", async () => {
		const result = await provider.deliver(makeParams());
		expect(result).toEqual({ success: true });
	});

	it("should POST to the correct Telegram API URL using botToken from params", async () => {
		const params = makeParams();
		await provider.deliver(params);

		expect(fetchFn).toHaveBeenCalledWith(
			"https://api.telegram.org/bot123456:ABC-DEF/sendMessage",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: "789",
					text: "<b>Hello</b> world",
					parse_mode: "HTML",
				}),
			}),
		);
	});

	it("should build URL using botToken from params, not a hardcoded token", async () => {
		const params = makeParams({ botToken: "999:XYZ" });
		await provider.deliver(params);

		expect(fetchFn).toHaveBeenCalledWith(
			"https://api.telegram.org/bot999:XYZ/sendMessage",
			expect.anything(),
		);
	});

	it("should send chatId and HTML text in request body", async () => {
		const params = makeParams({ chatId: "chat-abc", html: "<i>Test</i>" });
		await provider.deliver(params);

		expect(fetchFn).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				body: JSON.stringify({
					chat_id: "chat-abc",
					text: "<i>Test</i>",
					parse_mode: "HTML",
				}),
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// deliver — RATE_LIMITED (429, retryable)
// ---------------------------------------------------------------------------

describe("deliver — RATE_LIMITED (429)", () => {
	it("should throw EmitoError RATE_LIMITED with isRetryable true when Telegram returns 429", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(429, '{"ok":false,"description":"Too Many Requests"}'),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — DELIVERY_SPAM_COMPLAINT (403 + "blocked by the user", non-retryable)
// ---------------------------------------------------------------------------

describe("deliver — DELIVERY_SPAM_COMPLAINT (403 blocked by user)", () => {
	it("should throw EmitoError DELIVERY_SPAM_COMPLAINT with isRetryable false when bot is blocked", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(
				403,
				'{"ok":false,"description":"Forbidden: bot was blocked by the user"}',
			),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("should be case-insensitive when detecting 'blocked by the user' in response", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(
				403,
				'{"ok":false,"description":"Forbidden: Bot Was Blocked By The User"}',
			),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — DELIVERY_INVALID_ADDRESS (404, non-retryable)
// ---------------------------------------------------------------------------

describe("deliver — DELIVERY_INVALID_ADDRESS (404)", () => {
	it("should throw EmitoError DELIVERY_INVALID_ADDRESS with isRetryable false when Telegram returns 404", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(404, '{"ok":false,"description":"Not Found"}'),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — DELIVERY_REJECTED (4xx non-429/403-blocked/404, non-retryable)
// ---------------------------------------------------------------------------

describe("deliver — DELIVERY_REJECTED (4xx)", () => {
	it("should throw EmitoError DELIVERY_REJECTED with isRetryable false when Telegram returns 400", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(400, '{"ok":false,"description":"Bad Request"}'),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("should throw EmitoError DELIVERY_REJECTED with isRetryable false when Telegram returns 401", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(401, '{"ok":false,"description":"Unauthorized"}'),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("should throw EmitoError DELIVERY_REJECTED with isRetryable false when 403 response does not contain 'blocked by user'", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(403, '{"ok":false,"description":"Forbidden: something else"}'),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — PROVIDER_UNAVAILABLE (5xx, retryable)
// ---------------------------------------------------------------------------

describe("deliver — PROVIDER_UNAVAILABLE (5xx)", () => {
	it("should throw EmitoError PROVIDER_UNAVAILABLE with isRetryable true when Telegram returns 500", async () => {
		const provider = createTelegramProvider({ fetchFn: mockFetch(500, "internal_error") });

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("should throw EmitoError PROVIDER_UNAVAILABLE with isRetryable true when Telegram returns 503", async () => {
		const provider = createTelegramProvider({ fetchFn: mockFetch(503, "service_unavailable") });

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — network errors (PROVIDER_UNAVAILABLE, retryable)
// ---------------------------------------------------------------------------

describe("deliver — network errors", () => {
	it("should throw EmitoError PROVIDER_UNAVAILABLE with isRetryable true when fetch throws", async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error("fetch failed"));
		const provider = createTelegramProvider({ fetchFn });

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
			expect((err as EmitoError).cause).toBeInstanceOf(Error);
		}
	});

	it("should re-throw EmitoError instances without double-wrapping when fetch rejects with EmitoError", async () => {
		const original = new EmitoError({
			code: "RATE_LIMITED",
			message: "already classified",
			isRetryable: true,
		});
		const fetchFn = vi.fn().mockRejectedValue(original);
		const provider = createTelegramProvider({ fetchFn });

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
		}
	});
});

// ---------------------------------------------------------------------------
// deliver — error context: no credentials or PII
// ---------------------------------------------------------------------------

describe("deliver — error context", () => {
	it("should include provider, channel, notificationId, subscriberId in error context", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(400, '{"ok":false,"description":"Bad Request"}'),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).context).toEqual({
				provider: "telegram",
				channel: "telegram",
				notificationId: "notif-001",
				subscriberId: "sub-001",
			});
		}
	});

	it("should not include botToken in error context", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(400, '{"ok":false}'),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			const contextStr = JSON.stringify((err as EmitoError).context);
			expect(contextStr).not.toContain("123456:ABC-DEF");
			expect(contextStr).not.toContain("botToken");
		}
	});

	it("should not include chatId in error context", async () => {
		const provider = createTelegramProvider({
			fetchFn: mockFetch(400, '{"ok":false}'),
		});

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			const contextStr = JSON.stringify((err as EmitoError).context);
			expect(contextStr).not.toContain("chatId");
		}
	});
});
