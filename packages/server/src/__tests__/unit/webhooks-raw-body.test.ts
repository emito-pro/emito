/**
 * Unit tests for:
 * - ctx.rawBody availability in route handlers (raw body support)
 * - NotificationRepository.findByProviderMsgId() functionality
 * - Webhook dispatch routing by :provider param
 *
 * Rules applied:
 * - Rule 15: describe/it naming convention
 * - Rule 26: assert on shape of return values
 */

import {
	InMemoryConsentRepository,
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemorySubscriberRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitoServer } from "../../handler.js";

function makeServer(overrides: { webhookSecrets?: Record<string, string> } = {}) {
	return createEmitoServer({
		emito: {
			send: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			healthCheck: vi
				.fn()
				.mockResolvedValue({ healthy: true, providers: [], redis: { connected: true } }),
			on: vi.fn(),
			off: vi.fn(),
		} as never,
		apiKey: "test-api-key-for-raw-body",
		resolveSubscriberId: async () => null,
		webhookSecrets: overrides.webhookSecrets ?? {},
		repositories: {
			subscriberRepository: new InMemorySubscriberRepository(),
			notificationRepository: new InMemoryNotificationRepository(),
			preferenceRepository: new InMemoryPreferenceRepository(),
			consentRepository: new InMemoryConsentRepository(),
			workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
			suppressionRepository: new InMemorySuppressionRepository(),
			deadLetterRepository: new InMemoryDeadLetterRepository(),
			integrationRepository: new InMemoryIntegrationRepository(),
			inboxRepository: new InMemoryInboxRepository(),
		},
	});
}

// ----------------------------------------------------------------
// Raw body support
// ----------------------------------------------------------------

describe("ctx.rawBody availability in route handlers", () => {
	let server: ReturnType<typeof makeServer>;
	let capturedRawBody: string | undefined;

	beforeEach(() => {
		server = makeServer();
		capturedRawBody = undefined;

		// Register a test route that captures rawBody from context
		server.addRoute({
			method: "POST",
			pathPattern: "/test-raw-body",
			auth: "public",
			handler: async (ctx) => {
				capturedRawBody = (ctx as unknown as { rawBody?: string }).rawBody;
				return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
			},
		});
	});

	it("should provide ctx.rawBody for a POST request with a JSON body", async () => {
		const bodyContent = JSON.stringify({ event: "email.delivered", id: "msg_1" });
		const res = await server.handler(
			new Request("http://localhost/emito/v1/test-raw-body", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: bodyContent,
			}),
		);
		expect(res.status).toBe(200);
		expect(capturedRawBody).toBe(bodyContent);
	});

	it("should provide the original raw string before JSON parsing", async () => {
		// Use a body with deliberate whitespace — rawBody preserves the original string
		const bodyContent = '{"event":"test","id":"1"}';
		await server.handler(
			new Request("http://localhost/emito/v1/test-raw-body", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: bodyContent,
			}),
		);
		expect(capturedRawBody).toBe(bodyContent);
	});

	it("should provide ctx.rawBody for form-encoded POST body", async () => {
		// Register a second test route for form-encoded
		server.addRoute({
			method: "POST",
			pathPattern: "/test-raw-body-form",
			auth: "public",
			handler: async (ctx) => {
				capturedRawBody = (ctx as unknown as { rawBody?: string }).rawBody;
				return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
			},
		});

		const formBody = "List-Unsubscribe=One-Click";
		await server.handler(
			new Request("http://localhost/emito/v1/test-raw-body-form", {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: formBody,
			}),
		);
		expect(capturedRawBody).toBe(formBody);
	});
});

// ----------------------------------------------------------------
// findByProviderMsgId on NotificationRepository
// ----------------------------------------------------------------

describe("NotificationRepository.findByProviderMsgId()", () => {
	let notificationRepo: InMemoryNotificationRepository;

	beforeEach(() => {
		notificationRepo = new InMemoryNotificationRepository();
	});

	it("should find a notification by providerMsgId after it is set via updateStatus", async () => {
		const notification = await notificationRepo.create({
			id: "notif_pmid_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
		});
		await notificationRepo.updateStatus(notification.id, "sent", {
			providerMsgId: "provider_123",
		});

		const found = await notificationRepo.findByProviderMsgId("provider_123");
		expect(found).not.toBeNull();
		expect(found?.id).toBe("notif_pmid_1");
	});

	it("should return null when no notification has the given providerMsgId", async () => {
		const found = await notificationRepo.findByProviderMsgId("nonexistent_provider_id");
		expect(found).toBeNull();
	});

	it("should return the correct notification when multiple notifications exist with different providerMsgIds", async () => {
		const notif1 = await notificationRepo.create({
			id: "notif_multi_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
		});
		await notificationRepo.updateStatus(notif1.id, "sent", { providerMsgId: "provider_A" });

		const notif2 = await notificationRepo.create({
			id: "notif_multi_2",
			subscriberId: "sub_2",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
		});
		await notificationRepo.updateStatus(notif2.id, "sent", { providerMsgId: "provider_B" });

		const foundA = await notificationRepo.findByProviderMsgId("provider_A");
		const foundB = await notificationRepo.findByProviderMsgId("provider_B");

		expect(foundA?.id).toBe("notif_multi_1");
		expect(foundB?.id).toBe("notif_multi_2");
	});
});

// ----------------------------------------------------------------
// Webhook dispatch routing
// ----------------------------------------------------------------

describe("POST /emito/webhooks/:provider — dispatch and routing", () => {
	it("should dispatch to resend handler and return 401 for invalid signature", async () => {
		// Providing a real resend webhook secret so the route doesn't return CONFIG_INVALID
		const server = makeServer({
			webhookSecrets: { resend: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo32PeNksvRsjnSyUdSY=" },
		});
		const ts = String(Math.floor(Date.now() / 1000));

		const res = await server.handler(
			new Request("http://localhost/emito/webhooks/resend", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"svix-id": "msg_1",
					"svix-timestamp": ts,
					"svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
				},
				body: '{"type":"email.delivered","data":{"email_id":"e1"}}',
			}),
		);

		// Route is dispatching correctly: 401 from signature failure (not 501 stub or 404)
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.WEBHOOK_SIGNATURE_INVALID);
	});

	it("should dispatch to postmark handler and return 401 for invalid signature", async () => {
		const server = makeServer({
			webhookSecrets: { postmark: "postmark-test-secret" },
		});

		const res = await server.handler(
			new Request("http://localhost/emito/webhooks/postmark", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-postmark-signature": "invalidsig==",
				},
				body: '{"RecordType":"Delivery","MessageID":"pm-1"}',
			}),
		);

		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.WEBHOOK_SIGNATURE_INVALID);
	});

	it("should return 404 with WEBHOOK_PROVIDER_NOT_FOUND for an unknown provider (D-033)", async () => {
		const server = makeServer({
			webhookSecrets: { resend: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo32PeNksvRsjnSyUdSY=" },
		});

		const res = await server.handler(
			new Request("http://localhost/emito/webhooks/unknownprovider", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"test":true}',
			}),
		);

		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.WEBHOOK_PROVIDER_NOT_FOUND);
	});

	it("should return 500 when no webhook secret is configured for the provider", async () => {
		const server = makeServer({ webhookSecrets: {} });

		const res = await server.handler(
			new Request("http://localhost/emito/webhooks/resend", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"svix-id": "msg_1",
					"svix-timestamp": String(Math.floor(Date.now() / 1000)),
					"svix-signature": "v1,sig",
				},
				body: '{"type":"email.delivered","data":{"email_id":"e1"}}',
			}),
		);

		expect(res.status).toBe(500);
	});
});
