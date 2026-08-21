import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ProviderPlugin, SlackDeliveryParams } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSlackProvider } from "../index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeParams(overrides?: Partial<SlackDeliveryParams>): SlackDeliveryParams {
	return {
		channel: "slack",
		webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx",
		blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
		text: "Hello fallback",
		metadata: {
			notificationId: "notif-001",
			subscriberId: "sub-001",
			eventType: "test.event",
		},
		...overrides,
	};
}

function mockFetch(status: number, body = "ok"): typeof globalThis.fetch {
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
// createSlackProvider — construction
// ---------------------------------------------------------------------------

describe("createSlackProvider", () => {
	it("should return a provider with name 'slack' and channel 'slack'", () => {
		const provider = createSlackProvider();
		expect(provider.name).toBe("slack");
		expect(provider.channel).toBe("slack");
	});

	it("should accept an injected fetchFn for testing", () => {
		const fetchFn = mockFetch(200);
		const provider = createSlackProvider({ fetchFn });
		expect(provider).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// healthCheck
// ---------------------------------------------------------------------------

describe("healthCheck", () => {
	it("should return true", async () => {
		const provider = createSlackProvider();
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
		fetchFn = mockFetch(200, "ok");
		provider = createSlackProvider({ fetchFn });
	});

	it("should return success true when Slack responds with 200", async () => {
		const result = await provider.deliver(makeParams());
		expect(result).toEqual({ success: true });
	});

	it("should POST Block Kit JSON to the webhookUrl", async () => {
		const params = makeParams();
		await provider.deliver(params);

		expect(fetchFn).toHaveBeenCalledWith(
			params.webhookUrl,
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					blocks: params.blocks,
					text: params.text,
				}),
			}),
		);
	});

	it("should use the webhookUrl from params, not a hardcoded URL", async () => {
		const params = makeParams({ webhookUrl: "https://hooks.slack.com/services/T99/B99/yyy" });
		await provider.deliver(params);

		expect(fetchFn).toHaveBeenCalledWith(
			"https://hooks.slack.com/services/T99/B99/yyy",
			expect.anything(),
		);
	});
});

// ---------------------------------------------------------------------------
// deliver — RATE_LIMITED (429, retryable)
// ---------------------------------------------------------------------------

describe("deliver — RATE_LIMITED (429)", () => {
	it("should throw EmitoError RATE_LIMITED with isRetryable true when Slack returns 429", async () => {
		const provider = createSlackProvider({ fetchFn: mockFetch(429, "ratelimited") });

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
// deliver — DELIVERY_INVALID_ADDRESS (404, non-retryable)
// ---------------------------------------------------------------------------

describe("deliver — DELIVERY_INVALID_ADDRESS (404)", () => {
	it("should throw EmitoError DELIVERY_INVALID_ADDRESS with isRetryable false when Slack returns 404", async () => {
		const provider = createSlackProvider({ fetchFn: mockFetch(404, "channel_not_found") });

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
// deliver — DELIVERY_REJECTED (4xx non-429/404, non-retryable)
// ---------------------------------------------------------------------------

describe("deliver — DELIVERY_REJECTED (4xx)", () => {
	it("should throw EmitoError DELIVERY_REJECTED with isRetryable false when Slack returns 400", async () => {
		const provider = createSlackProvider({ fetchFn: mockFetch(400, "invalid_payload") });

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("should throw EmitoError DELIVERY_REJECTED with isRetryable false when Slack returns 401", async () => {
		const provider = createSlackProvider({ fetchFn: mockFetch(401, "unauthorized") });

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect((err as EmitoError).isRetryable).toBe(false);
		}
	});

	it("should throw EmitoError DELIVERY_REJECTED with isRetryable false when Slack returns 403", async () => {
		const provider = createSlackProvider({ fetchFn: mockFetch(403, "forbidden") });

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
	it("should throw EmitoError PROVIDER_UNAVAILABLE with isRetryable true when Slack returns 500", async () => {
		const provider = createSlackProvider({ fetchFn: mockFetch(500, "internal_error") });

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
		}
	});

	it("should throw EmitoError PROVIDER_UNAVAILABLE with isRetryable true when Slack returns 503", async () => {
		const provider = createSlackProvider({ fetchFn: mockFetch(503, "service_unavailable") });

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
		const provider = createSlackProvider({ fetchFn });

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
		const provider = createSlackProvider({ fetchFn });

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
		const provider = createSlackProvider({ fetchFn: mockFetch(400, "bad") });

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).context).toEqual({
				provider: "slack",
				channel: "slack",
				notificationId: "notif-001",
				subscriberId: "sub-001",
			});
		}
	});

	it("should not include webhookUrl in error context", async () => {
		const provider = createSlackProvider({ fetchFn: mockFetch(400, "bad") });

		try {
			await provider.deliver(makeParams());
			expect.fail("should have thrown");
		} catch (err) {
			const contextStr = JSON.stringify((err as EmitoError).context);
			expect(contextStr).not.toContain("hooks.slack.com");
			expect(contextStr).not.toContain("webhookUrl");
		}
	});
});
