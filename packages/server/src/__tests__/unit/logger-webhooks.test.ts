/**
 * Tests verifying that logger.warn() is called at webhook error sites.
 *
 * Plan task 1 requires:
 *   - process.ts: log signature failures and parse failures
 *   - webhooks.ts: log unknown provider, missing secret, missing body
 *
 * Success criteria verified:
 * - logger.warn called for signature invalid (process.ts)
 * - logger.warn called for parse failure (process.ts)
 * - logger.warn called for unknown provider (webhooks.ts)
 * - logger.warn called for missing secret (webhooks.ts)
 * - logger.warn called for missing body (webhooks.ts)
 * - Log fields include provider and/or errorCode (no PII)
 * - Fields-first format: object first, static string second
 * - No email, phone, name, apiKey, secret, token in logged fields
 *
 * Rules applied:
 * - Rule 1: Assert on specific EmitoErrorCode values
 * - Rule 10: Never mock the module under test
 * - Rule 12: Use in-memory repository stubs for unit tests
 * - Rule 13: Use mockLogger for all tests
 * - Rule 15: describe("functionName") > it("should {behavior} when {condition}")
 * - Rule 21: Always verify credentials are excluded from logs
 * - Rule 28: Assert on call arguments for mock function verifications
 */

import { InMemoryNotificationRepository, InMemorySuppressionRepository } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processWebhook } from "../../endpoints/webhooks/process.js";
import type { WebhookEvent, WebhookVerifier } from "../../endpoints/webhooks/types.js";
import {
	type WebhookEndpointDeps,
	registerWebhookEndpoints,
} from "../../endpoints/webhooks/webhooks.js";
import { createRouter } from "../../router.js";

// ---------------------------------------------------------------------------
// Mock logger (inline — no shared mock file yet in server package)
// ---------------------------------------------------------------------------

function createMockLogger() {
	const logger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(),
	};
	// child() returns same mock instance for assertion convenience
	logger.child.mockReturnValue(logger);
	return logger;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockVerifier(opts: {
	verifyResult: boolean;
	events?: WebhookEvent[];
}): WebhookVerifier {
	return {
		verify: vi.fn().mockReturnValue(opts.verifyResult),
		normalize: vi.fn().mockReturnValue(opts.events ?? []),
	};
}

function makeHeaders(record: Record<string, string>): Headers {
	return new Headers(record);
}

const VALID_BODY = '{"test":true}';
const INVALID_JSON_BODY = "not-json{{{";

// ---------------------------------------------------------------------------
// processWebhook() — logger calls in process.ts
// ---------------------------------------------------------------------------

describe("processWebhook() — logger calls", () => {
	let notificationRepo: InMemoryNotificationRepository;
	let suppressionRepo: InMemorySuppressionRepository;

	beforeEach(() => {
		notificationRepo = new InMemoryNotificationRepository();
		suppressionRepo = new InMemorySuppressionRepository();
	});

	describe("signature validation failure", () => {
		it("should call logger.warn when signature is invalid", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: false });

			await expect(
				processWebhook({
					provider: "resend",
					verifier,
					rawBody: VALID_BODY,
					headers: makeHeaders({}),
					secret: "secret",
					deps: {
						notificationRepository: notificationRepo,
						suppressionRepository: suppressionRepo,
					},
					logger,
				}),
			).rejects.toThrow();

			expect(logger.warn).toHaveBeenCalled();
		});

		it("should include provider in logger.warn fields for signature failure", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: false });

			await expect(
				processWebhook({
					provider: "resend",
					verifier,
					rawBody: VALID_BODY,
					headers: makeHeaders({}),
					secret: "secret",
					deps: {
						notificationRepository: notificationRepo,
						suppressionRepository: suppressionRepo,
					},
					logger,
				}),
			).rejects.toThrow();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ provider: "resend" }),
				expect.any(String),
			);
		});

		it("should include errorCode in logger.warn fields for signature failure", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: false });

			await expect(
				processWebhook({
					provider: "resend",
					verifier,
					rawBody: VALID_BODY,
					headers: makeHeaders({}),
					secret: "secret",
					deps: {
						notificationRepository: notificationRepo,
						suppressionRepository: suppressionRepo,
					},
					logger,
				}),
			).rejects.toThrow();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ errorCode: EMITO_ERROR_CODE.WEBHOOK_SIGNATURE_INVALID }),
				expect.any(String),
			);
		});

		it("should use fields-first format for signature failure log", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: false });

			await expect(
				processWebhook({
					provider: "resend",
					verifier,
					rawBody: VALID_BODY,
					headers: makeHeaders({}),
					secret: "secret",
					deps: {
						notificationRepository: notificationRepo,
						suppressionRepository: suppressionRepo,
					},
					logger,
				}),
			).rejects.toThrow();

			const [fieldsArg, msgArg] = logger.warn.mock.calls[0] as [unknown, unknown];
			expect(typeof fieldsArg).toBe("object");
			expect(fieldsArg).not.toBeNull();
			expect(typeof msgArg).toBe("string");
		});

		it("should NOT log secret, apiKey, token, email, or phone in signature failure log", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: false });

			await expect(
				processWebhook({
					provider: "resend",
					verifier,
					rawBody: VALID_BODY,
					headers: makeHeaders({}),
					secret: "my-super-secret-key",
					deps: {
						notificationRepository: notificationRepo,
						suppressionRepository: suppressionRepo,
					},
					logger,
				}),
			).rejects.toThrow();

			for (const call of logger.warn.mock.calls) {
				const fields = call[0] as Record<string, unknown>;
				expect(fields).not.toHaveProperty("secret");
				expect(fields).not.toHaveProperty("apiKey");
				expect(fields).not.toHaveProperty("token");
				expect(fields).not.toHaveProperty("email");
				expect(fields).not.toHaveProperty("phone");
				expect(fields).not.toHaveProperty("name");
				expect(fields).not.toHaveProperty("body");
				// Must not contain the actual secret value
				const valuesStr = JSON.stringify(Object.values(fields));
				expect(valuesStr).not.toContain("my-super-secret-key");
			}
		});
	});

	describe("payload parse failure", () => {
		it("should call logger.warn when rawBody is not valid JSON", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: true });

			await expect(
				processWebhook({
					provider: "resend",
					verifier,
					rawBody: INVALID_JSON_BODY,
					headers: makeHeaders({}),
					secret: "secret",
					deps: {
						notificationRepository: notificationRepo,
						suppressionRepository: suppressionRepo,
					},
					logger,
				}),
			).rejects.toThrow();

			expect(logger.warn).toHaveBeenCalled();
		});

		it("should include provider in logger.warn fields for parse failure", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: true });

			await expect(
				processWebhook({
					provider: "sendgrid",
					verifier,
					rawBody: INVALID_JSON_BODY,
					headers: makeHeaders({}),
					secret: "secret",
					deps: {
						notificationRepository: notificationRepo,
						suppressionRepository: suppressionRepo,
					},
					logger,
				}),
			).rejects.toThrow();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ provider: "sendgrid" }),
				expect.any(String),
			);
		});

		it("should include errorCode in logger.warn fields for parse failure", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: true });

			await expect(
				processWebhook({
					provider: "resend",
					verifier,
					rawBody: INVALID_JSON_BODY,
					headers: makeHeaders({}),
					secret: "secret",
					deps: {
						notificationRepository: notificationRepo,
						suppressionRepository: suppressionRepo,
					},
					logger,
				}),
			).rejects.toThrow();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ errorCode: EMITO_ERROR_CODE.WEBHOOK_PARSE_FAILED }),
				expect.any(String),
			);
		});

		it("should NOT log secret, body, email, phone, or name in parse failure log", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: true });

			await expect(
				processWebhook({
					provider: "resend",
					verifier,
					rawBody: INVALID_JSON_BODY,
					headers: makeHeaders({}),
					secret: "my-super-secret-key",
					deps: {
						notificationRepository: notificationRepo,
						suppressionRepository: suppressionRepo,
					},
					logger,
				}),
			).rejects.toThrow();

			for (const call of logger.warn.mock.calls) {
				const fields = call[0] as Record<string, unknown>;
				expect(fields).not.toHaveProperty("secret");
				expect(fields).not.toHaveProperty("rawBody");
				expect(fields).not.toHaveProperty("body");
				expect(fields).not.toHaveProperty("apiKey");
				expect(fields).not.toHaveProperty("token");
				expect(fields).not.toHaveProperty("email");
				expect(fields).not.toHaveProperty("phone");
				expect(fields).not.toHaveProperty("name");
			}
		});
	});

	describe("successful processing", () => {
		it("should NOT call logger.warn when signature is valid and payload parses cleanly", async () => {
			const logger = createMockLogger();
			const verifier = makeMockVerifier({ verifyResult: true, events: [] });

			await processWebhook({
				provider: "resend",
				verifier,
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: {
					notificationRepository: notificationRepo,
					suppressionRepository: suppressionRepo,
				},
				logger,
			});

			expect(logger.warn).not.toHaveBeenCalled();
		});
	});
});

// ---------------------------------------------------------------------------
// registerWebhookEndpoints() — logger calls in webhooks.ts
// ---------------------------------------------------------------------------

describe("registerWebhookEndpoints() — logger calls", () => {
	function makeRouter() {
		return createRouter("/emito");
	}

	function makeDeps(overrides: Partial<WebhookEndpointDeps> = {}): WebhookEndpointDeps {
		return {
			notificationRepository: new InMemoryNotificationRepository(),
			suppressionRepository: new InMemorySuppressionRepository(),
			webhookSecrets: { resend: "test-secret" },
			...overrides,
		};
	}

	describe("unknown provider", () => {
		it("should call logger.warn when provider is not found in PROVIDER_VERIFIERS", async () => {
			const logger = createMockLogger();
			const router = makeRouter();
			const deps = makeDeps({ logger });
			registerWebhookEndpoints(router, deps);

			const match = router.match("POST", "/emito/webhooks/unknownprovider")!;
			expect(match).not.toBeNull();

			await match.route
				.handler(
					{
						params: { provider: "unknownprovider" },
						query: {},
						body: undefined,
						rawBody: VALID_BODY,
					} as never,
					new Request("http://localhost/emito/webhooks/unknownprovider", {
						method: "POST",
						body: VALID_BODY,
					}),
				)
				.catch(() => undefined); // Throws EmitoError — swallow for assertion

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ provider: "unknownprovider" }),
				expect.any(String),
			);
		});

		it("should include errorCode in logger.warn fields for unknown provider", async () => {
			const logger = createMockLogger();
			const router = makeRouter();
			registerWebhookEndpoints(router, makeDeps({ logger }));

			const match = router.match("POST", "/emito/webhooks/unknownprovider")!;

			await match.route
				.handler(
					{
						params: { provider: "unknownprovider" },
						query: {},
						body: undefined,
						rawBody: VALID_BODY,
					} as never,
					new Request("http://localhost/emito/webhooks/unknownprovider", { method: "POST" }),
				)
				.catch(() => undefined);

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ errorCode: EMITO_ERROR_CODE.WEBHOOK_PROVIDER_NOT_FOUND }),
				expect.any(String),
			);
		});
	});

	describe("missing webhook secret", () => {
		it("should call logger.warn when no secret is configured for provider", async () => {
			const logger = createMockLogger();
			const router = makeRouter();
			// resend verifier exists, but no secret configured
			registerWebhookEndpoints(router, makeDeps({ webhookSecrets: {}, logger }));

			const match = router.match("POST", "/emito/webhooks/resend")!;
			expect(match).not.toBeNull();

			await match.route
				.handler(
					{
						params: { provider: "resend" },
						query: {},
						body: undefined,
						rawBody: VALID_BODY,
					} as never,
					new Request("http://localhost/emito/webhooks/resend", { method: "POST" }),
				)
				.catch(() => undefined);

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ provider: "resend" }),
				expect.any(String),
			);
		});

		it("should NOT log the missing secret value in warn fields", async () => {
			const logger = createMockLogger();
			const router = makeRouter();
			registerWebhookEndpoints(router, makeDeps({ webhookSecrets: {}, logger }));

			const match = router.match("POST", "/emito/webhooks/resend")!;

			await match.route
				.handler(
					{
						params: { provider: "resend" },
						query: {},
						body: undefined,
						rawBody: VALID_BODY,
					} as never,
					new Request("http://localhost/emito/webhooks/resend", { method: "POST" }),
				)
				.catch(() => undefined);

			for (const call of logger.warn.mock.calls) {
				const fields = call[0] as Record<string, unknown>;
				expect(fields).not.toHaveProperty("secret");
				expect(fields).not.toHaveProperty("apiKey");
				expect(fields).not.toHaveProperty("token");
				expect(fields).not.toHaveProperty("email");
				expect(fields).not.toHaveProperty("phone");
			}
		});
	});

	describe("missing request body", () => {
		it("should call logger.warn when rawBody is absent", async () => {
			const logger = createMockLogger();
			const router = makeRouter();
			registerWebhookEndpoints(router, makeDeps({ logger }));

			const match = router.match("POST", "/emito/webhooks/resend")!;
			expect(match).not.toBeNull();

			await match.route
				.handler(
					{
						params: { provider: "resend" },
						query: {},
						body: undefined,
						rawBody: undefined, // No raw body
					} as never,
					new Request("http://localhost/emito/webhooks/resend", { method: "POST" }),
				)
				.catch(() => undefined);

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ provider: "resend" }),
				expect.any(String),
			);
		});

		it("should include errorCode in logger.warn fields for missing body", async () => {
			const logger = createMockLogger();
			const router = makeRouter();
			registerWebhookEndpoints(router, makeDeps({ logger }));

			const match = router.match("POST", "/emito/webhooks/resend")!;

			await match.route
				.handler(
					{
						params: { provider: "resend" },
						query: {},
						body: undefined,
						rawBody: undefined,
					} as never,
					new Request("http://localhost/emito/webhooks/resend", { method: "POST" }),
				)
				.catch(() => undefined);

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ errorCode: EMITO_ERROR_CODE.WEBHOOK_PARSE_FAILED }),
				expect.any(String),
			);
		});
	});

	describe("fields-first format — all webhook warn calls", () => {
		it("should use fields-first format for unknown provider warn", async () => {
			const logger = createMockLogger();
			const router = makeRouter();
			registerWebhookEndpoints(router, makeDeps({ logger }));

			const match = router.match("POST", "/emito/webhooks/unknownprovider")!;
			await match.route
				.handler(
					{
						params: { provider: "unknownprovider" },
						query: {},
						body: undefined,
						rawBody: VALID_BODY,
					} as never,
					new Request("http://localhost/emito/webhooks/unknownprovider", { method: "POST" }),
				)
				.catch(() => undefined);

			const [fieldsArg, msgArg] = logger.warn.mock.calls[0] as [unknown, unknown];
			expect(typeof fieldsArg).toBe("object");
			expect(fieldsArg).not.toBeNull();
			expect(typeof msgArg).toBe("string");
		});
	});
});
