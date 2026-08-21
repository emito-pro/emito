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
import type { Emito } from "@emito/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitoServer } from "../handler.js";

const API_KEY = "test-admin-api-key-32-chars-long!!";

function adminHeaders(): Record<string, string> {
	return { "x-emito-admin-key": API_KEY };
}

function jsonHeaders(): Record<string, string> {
	return { ...adminHeaders(), "content-type": "application/json" };
}

async function parseJson(response: Response): Promise<unknown> {
	return JSON.parse(await response.text());
}

function createMockEmito(): Emito {
	return {
		send: vi.fn().mockResolvedValue({ notificationId: "ntf_retry_001", channels: [] }),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		healthCheck: vi.fn().mockResolvedValue({ healthy: true, providers: [], redis: null }),
		on: vi.fn(),
		off: vi.fn(),
		getEventNames: vi.fn().mockReturnValue([]),
		getEvent: vi.fn(),
	};
}

function createTestServer() {
	const subscriberRepo = new InMemorySubscriberRepository();
	const notificationRepo = new InMemoryNotificationRepository();
	const deadLetterRepo = new InMemoryDeadLetterRepository();
	const suppressionRepo = new InMemorySuppressionRepository();
	const integrationRepo = new InMemoryIntegrationRepository();
	const workspaceDefaultRepo = new InMemoryWorkspaceDefaultRepository();
	const inboxRepo = new InMemoryInboxRepository();
	const preferenceRepo = new InMemoryPreferenceRepository();
	const emito = createMockEmito();

	const server = createEmitoServer({
		emito,
		apiKey: API_KEY,
		resolveSubscriberId: async () => null,
		repositories: {
			subscriberRepository: subscriberRepo,
			notificationRepository: notificationRepo,
			deadLetterRepository: deadLetterRepo,
			suppressionRepository: suppressionRepo,
			integrationRepository: integrationRepo,
			workspaceDefaultRepository: workspaceDefaultRepo,
			inboxRepository: inboxRepo,
			preferenceRepository: preferenceRepo,
			consentRepository: new InMemoryConsentRepository(),
		},
	});

	return {
		server,
		emito,
		subscriberRepo,
		notificationRepo,
		deadLetterRepo,
		suppressionRepo,
		integrationRepo,
		workspaceDefaultRepo,
	};
}

// --- Admin Subscriber Endpoints ---

describe("Admin Subscriber Endpoints", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer();
	});

	it("GET /admin/subscribers — returns empty list", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers", {
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { items: unknown[]; hasMore: boolean } };
		expect(body.data.items).toEqual([]);
		expect(body.data.hasMore).toBe(false);
	});

	it("GET /admin/subscribers — returns subscribers", async () => {
		await ctx.subscriberRepo.create({
			id: "sub_001",
			email: "alice@example.com",
		});
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers", {
				headers: adminHeaders(),
			}),
		);
		const body = (await parseJson(res)) as { data: { items: Array<{ id: string }> } };
		expect(body.data.items).toHaveLength(1);
		expect(body.data.items[0]!.id).toBe("sub_001");
	});

	it("GET /admin/subscribers/:id — returns subscriber", async () => {
		await ctx.subscriberRepo.create({
			id: "sub_002",
			email: "bob@example.com",
		});
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers/sub_002", {
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { id: string; email: string } };
		expect(body.data.id).toBe("sub_002");
		expect(body.data.email).toBe("bob@example.com");
	});

	it("GET /admin/subscribers/:id — returns 404 for unknown subscriber", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers/sub_unknown", {
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(404);
	});

	it("POST /admin/subscribers — creates subscriber", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers", {
				method: "POST",
				headers: jsonHeaders(),
				body: JSON.stringify({
					id: "sub_new",
					email: "new@example.com",
					lang: "en",
				}),
			}),
		);
		expect(res.status).toBe(201);
		const body = (await parseJson(res)) as { data: { id: string; email: string } };
		expect(body.data.id).toBe("sub_new");
		expect(body.data.email).toBe("new@example.com");
	});

	it("POST /admin/subscribers — upserts existing subscriber", async () => {
		await ctx.subscriberRepo.create({
			id: "sub_existing",
			email: "old@example.com",
		});
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers", {
				method: "POST",
				headers: jsonHeaders(),
				body: JSON.stringify({
					id: "sub_existing",
					email: "updated@example.com",
				}),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { email: string } };
		expect(body.data.email).toBe("updated@example.com");
	});

	it("POST /admin/subscribers/:id/erase — erases subscriber data", async () => {
		await ctx.subscriberRepo.create({
			id: "sub_erase",
			email: "erase@example.com",
			phone: "+1234567890",
		});
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers/sub_erase/erase", {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { id: string; erased: boolean } };
		expect(body.data.erased).toBe(true);

		// Verify erasure
		const erased = await ctx.subscriberRepo.findById("sub_erase");
		expect(erased?.email).toBeUndefined();
		expect(erased?.phone).toBeUndefined();
	});

	it("POST /admin/subscribers/:id/erase — returns 404 for unknown subscriber", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers/sub_ghost/erase", {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(404);
	});

	it("rejects requests without API key", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers"),
		);
		expect(res.status).toBe(401);
	});

	it("rejects requests with wrong API key", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/subscribers", {
				headers: { "x-emito-admin-key": "wrong-key-that-is-32-chars-long!" },
			}),
		);
		expect(res.status).toBe(401);
	});
});

// --- Admin Notification Endpoints ---

describe("Admin Notification Endpoints", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer();
	});

	it("GET /admin/notifications — returns cross-workspace log", async () => {
		await ctx.notificationRepo.create({
			subscriberId: "sub_001",
			workspaceId: "ws_001",
			eventType: "invoice.paid",
			category: "transactional",
			channel: "email",
		});
		await ctx.notificationRepo.create({
			subscriberId: "sub_002",
			workspaceId: "ws_002",
			eventType: "welcome",
			category: "transactional",
			channel: "sms",
		});

		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/notifications", {
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { items: unknown[] } };
		expect(body.data.items).toHaveLength(2);
	});

	it("GET /admin/notifications — supports filtering", async () => {
		await ctx.notificationRepo.create({
			subscriberId: "sub_001",
			eventType: "invoice.paid",
			category: "transactional",
			channel: "email",
		});
		await ctx.notificationRepo.create({
			subscriberId: "sub_002",
			eventType: "promo",
			category: "marketing",
			channel: "email",
		});

		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/notifications?category=transactional", {
				headers: adminHeaders(),
			}),
		);
		const body = (await parseJson(res)) as { data: { items: Array<{ category: string }> } };
		expect(body.data.items).toHaveLength(1);
		expect(body.data.items[0]!.category).toBe("transactional");
	});
});

// --- Admin Dead Letter Endpoints ---

describe("Admin Dead Letter Endpoints", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer();
	});

	it("GET /admin/dead-letters — returns unresolved dead letters", async () => {
		await ctx.deadLetterRepo.create({
			notificationId: "ntf_001",
			subscriberId: "sub_001",
			eventType: "invoice.paid",
			channel: "email",
			attempts: [
				{
					provider: "resend",
					timestamp: new Date(),
					errorCode: "DELIVERY_FAILED",
					errorMessage: "Connection refused",
				},
			],
			payload: { subject: "Invoice" },
		});

		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/dead-letters", {
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { items: unknown[] } };
		expect(body.data.items).toHaveLength(1);
	});

	it("POST /admin/dead-letters/:id/retry — retries dead letter", async () => {
		const dl = await ctx.deadLetterRepo.create({
			notificationId: "ntf_retry",
			subscriberId: "sub_001",
			eventType: "invoice.paid",
			channel: "email",
			attempts: [],
			payload: { subject: "Invoice" },
		});

		const res = await ctx.server.handler(
			new Request(`http://localhost/emito/v1/admin/dead-letters/${dl.id}/retry`, {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { resolution: string } };
		expect(body.data.resolution).toBe("retried");

		// Verify emito.send was called
		expect(ctx.emito.send).toHaveBeenCalledWith({
			event: "invoice.paid",
			subscriberId: "sub_001",
			payload: { subject: "Invoice" },
		});
	});

	it("POST /admin/dead-letters/:id/retry — returns 404 for unknown", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/dead-letters/dlq_unknown/retry", {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(404);
	});

	it("POST /admin/dead-letters/:id/retry — rejects already resolved", async () => {
		const dl = await ctx.deadLetterRepo.create({
			notificationId: "ntf_resolved",
			subscriberId: "sub_001",
			eventType: "test",
			channel: "email",
			attempts: [],
			payload: {},
		});
		await ctx.deadLetterRepo.resolve(dl.id, "discarded");

		const res = await ctx.server.handler(
			new Request(`http://localhost/emito/v1/admin/dead-letters/${dl.id}/retry`, {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(409);
	});

	it("POST /admin/dead-letters/:id/retry — rejects concurrent retry (retrying state)", async () => {
		const dl = await ctx.deadLetterRepo.create({
			notificationId: "ntf_concurrent",
			subscriberId: "sub_001",
			eventType: "invoice.paid",
			channel: "email",
			attempts: [],
			payload: {},
		});

		// Simulate a concurrent retry already in progress by setting "retrying" state
		await ctx.deadLetterRepo.resolve(dl.id, "retrying");

		const res = await ctx.server.handler(
			new Request(`http://localhost/emito/v1/admin/dead-letters/${dl.id}/retry`, {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(409);
	});

	it("POST /admin/dead-letters/:id/retry — unresolves on send failure", async () => {
		const dl = await ctx.deadLetterRepo.create({
			notificationId: "ntf_fail_retry",
			subscriberId: "sub_001",
			eventType: "invoice.paid",
			channel: "email",
			attempts: [],
			payload: {},
		});

		// Make emito.send throw
		vi.mocked(ctx.emito.send).mockRejectedValueOnce(new Error("send failed"));

		const res = await ctx.server.handler(
			new Request(`http://localhost/emito/v1/admin/dead-letters/${dl.id}/retry`, {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(500);

		// Dead letter should be unresolved (not stuck in "retrying")
		const record = await ctx.deadLetterRepo.findById(dl.id);
		expect(record?.resolvedAt).toBeUndefined();
		expect(record?.resolution).toBeUndefined();
	});

	it("POST /admin/dead-letters/:id/discard — discards dead letter", async () => {
		const dl = await ctx.deadLetterRepo.create({
			notificationId: "ntf_discard",
			subscriberId: "sub_001",
			eventType: "test",
			channel: "email",
			attempts: [],
			payload: {},
		});

		const res = await ctx.server.handler(
			new Request(`http://localhost/emito/v1/admin/dead-letters/${dl.id}/discard`, {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { resolution: string } };
		expect(body.data.resolution).toBe("discarded");
	});
});

// --- Admin Suppression Endpoints ---

describe("Admin Suppression Endpoints", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer();
	});

	it("GET /admin/suppression — returns suppressed addresses", async () => {
		await ctx.suppressionRepo.create({
			address: "bounce@example.com",
			channel: "email",
			reason: "hard_bounce",
		});

		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/suppression", {
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as {
			data: { items: Array<{ address: string }> };
		};
		expect(body.data.items).toHaveLength(1);
		expect(body.data.items[0]!.address).toBe("bounce@example.com");
	});

	it("POST /admin/suppression — adds suppression", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/suppression", {
				method: "POST",
				headers: jsonHeaders(),
				body: JSON.stringify({
					address: "spam@example.com",
					channel: "email",
					reason: "manual_suppression",
				}),
			}),
		);
		expect(res.status).toBe(201);
		const body = (await parseJson(res)) as { data: { address: string; reason: string } };
		expect(body.data.address).toBe("spam@example.com");
		expect(body.data.reason).toBe("manual_suppression");
	});

	it("POST /admin/suppression — validates body", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/suppression", {
				method: "POST",
				headers: jsonHeaders(),
				body: JSON.stringify({
					address: "spam@example.com",
					// missing channel and reason
				}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("POST /admin/suppression/:id/archive — archives suppression", async () => {
		const record = await ctx.suppressionRepo.create({
			address: "archived@example.com",
			channel: "email",
			reason: "hard_bounce",
		});

		const res = await ctx.server.handler(
			new Request(`http://localhost/emito/v1/admin/suppression/${record.id}/archive`, {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { archived: boolean } };
		expect(body.data.archived).toBe(true);

		// Verify it's archived — no longer found as active
		const active = await ctx.suppressionRepo.findByAddressAndChannel(
			"archived@example.com",
			"email",
		);
		expect(active).toBeNull();
	});

	it("POST /admin/suppression/:id/archive — returns 404 for unknown", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/suppression/sup_unknown/archive", {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(404);
	});

	it("POST /admin/suppression/:id/archive — rejects already archived", async () => {
		const record = await ctx.suppressionRepo.create({
			address: "double@example.com",
			channel: "email",
			reason: "hard_bounce",
		});
		await ctx.suppressionRepo.archive("double@example.com", "email");

		const res = await ctx.server.handler(
			new Request(`http://localhost/emito/v1/admin/suppression/${record.id}/archive`, {
				method: "POST",
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(409);
	});
});

// --- Admin Workspace Endpoints ---

describe("Admin Workspace Endpoints", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer();
	});

	it("GET /admin/workspaces/:id/integrations — returns workspace integrations", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/workspaces/ws_001/integrations", {
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { items: unknown[] } };
		expect(body.data.items).toEqual([]);
	});

	it("GET /admin/workspaces/:id/defaults — returns workspace defaults", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/workspaces/ws_001/defaults", {
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { items: unknown[] } };
		expect(body.data.items).toEqual([]);
	});

	it("POST /admin/workspaces/:id/integrations — adds integration", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/workspaces/ws_001/integrations", {
				method: "POST",
				headers: jsonHeaders(),
				body: JSON.stringify({
					channel: "email",
					config: { apiKey: "sg-key" },
				}),
			}),
		);
		expect(res.status).toBe(201);
	});

	it("PUT /admin/workspaces/:id/defaults — sets workspace defaults", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/workspaces/ws_001/defaults", {
				method: "PUT",
				headers: jsonHeaders(),
				body: JSON.stringify({
					topicKey: "promotions",
					channel: "email",
					enabled: false,
					isMandatory: true,
				}),
			}),
		);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as {
			data: { topicKey: string; enabled: boolean };
		};
		expect(body.data.topicKey).toBe("promotions");
	});

	it("PUT /admin/workspaces/:id/defaults — validates body", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/workspaces/ws_001/defaults", {
				method: "PUT",
				headers: jsonHeaders(),
				body: JSON.stringify({ topicKey: "promo" }), // missing required fields
			}),
		);
		expect(res.status).toBe(400);
	});

	it("accepts any non-empty string as workspace ID", async () => {
		const res = await ctx.server.handler(
			new Request("http://localhost/emito/v1/admin/workspaces/acme-corp/defaults", {
				headers: adminHeaders(),
			}),
		);
		expect(res.status).toBe(200);
	});
});
