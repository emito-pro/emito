import type { Emito } from "@emito/core";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitoServer } from "../../handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_KEY = "test-admin-key-for-unit-tests";
const PREFIX = "/emito";
/** Versioned API base — `prefix` is the mount path, routes live under it. */
const API_BASE = `${PREFIX}/v1`;

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

function makeAdminRequest(method: string, path: string, body?: unknown): Request {
	return new Request(`http://localhost${API_BASE}${path}`, {
		method,
		headers: {
			"x-emito-admin-key": ADMIN_KEY,
			...(body !== undefined ? { "content-type": "application/json" } : {}),
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

function makeUnauthRequest(method: string, path: string, body?: unknown): Request {
	return new Request(`http://localhost${API_BASE}${path}`, {
		method,
		headers: body !== undefined ? { "content-type": "application/json" } : {},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

function makeWrongKeyRequest(method: string, path: string): Request {
	return new Request(`http://localhost${API_BASE}${path}`, {
		method,
		headers: { "x-emito-admin-key": "wrong-key-value" },
	});
}

async function parseJson(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

// ---------------------------------------------------------------------------
// Test data builders (never inline object literals)
// ---------------------------------------------------------------------------

function buildSubscriberData(overrides: Record<string, unknown> = {}) {
	return {
		id: "sub_1",
		email: "user1@example.com",
		phone: "+15550001111",
		metadata: {},
		...overrides,
	};
}

function seedSubscriber(
	repo: InMemorySubscriberRepository,
	overrides: Record<string, unknown> = {},
) {
	const sub = {
		id: "sub_1",
		email: "user1@example.com",
		phone: "+15550001111",
		metadata: {},
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		erasedAt: undefined,
		...overrides,
	};
	repo.seed(sub as Parameters<typeof repo.seed>[0]);
	return sub;
}

function seedDeadLetter(repo: InMemoryDeadLetterRepository) {
	return repo.create({
		notificationId: "ntf_1",
		subscriberId: "sub_1",
		eventType: "order.placed",
		channel: "email",
		attempts: [
			{
				provider: "sendgrid",
				timestamp: new Date("2026-01-01T00:00:00Z"),
				errorCode: "PROVIDER_TIMEOUT",
				errorMessage: "Connection timed out",
			},
		],
		payload: { subject: "Your order" },
	});
}

function seedSuppression(repo: InMemorySuppressionRepository) {
	return repo.create({
		address: "bounced@example.com",
		channel: "email",
		reason: "hard_bounce",
	});
}

// ---------------------------------------------------------------------------
// Server factory — passes repos into config
// ---------------------------------------------------------------------------

function makeServer() {
	const subscriberRepo = new InMemorySubscriberRepository();
	const notificationRepo = new InMemoryNotificationRepository();
	const deadLetterRepo = new InMemoryDeadLetterRepository();
	const suppressionRepo = new InMemorySuppressionRepository();
	const integrationRepo = new InMemoryIntegrationRepository();
	const workspaceDefaultRepo = new InMemoryWorkspaceDefaultRepository();

	const mockEmito: Emito = {
		send: vi.fn().mockResolvedValue({ results: [] }),
		start: vi.fn(),
		stop: vi.fn(),
		healthCheck: vi.fn().mockResolvedValue({ healthy: true, providers: [] }),
		on: vi.fn(),
		off: vi.fn(),
		getEventNames: vi.fn().mockReturnValue([]),
		getEvent: vi.fn(),
	};

	const server = createEmitoServer({
		emito: mockEmito,
		apiKey: ADMIN_KEY,
		resolveSubscriberId: async () => null,
		prefix: PREFIX,
		repositories: {
			subscriberRepository: subscriberRepo,
			notificationRepository: notificationRepo,
			deadLetterRepository: deadLetterRepo,
			suppressionRepository: suppressionRepo,
			integrationRepository: integrationRepo,
			workspaceDefaultRepository: workspaceDefaultRepo,
			inboxRepository: new InMemoryInboxRepository(),
			preferenceRepository: new InMemoryPreferenceRepository(),
			consentRepository: new InMemoryConsentRepository(),
		},
	});

	return {
		server,
		mockEmito,
		subscriberRepo,
		notificationRepo,
		deadLetterRepo,
		suppressionRepo,
		integrationRepo,
		workspaceDefaultRepo,
	};
}

// ---------------------------------------------------------------------------
// Shared auth assertion — run for every admin route
// ---------------------------------------------------------------------------

async function assertAdminAuthRequired(
	handler: (req: Request) => Promise<Response>,
	method: string,
	path: string,
) {
	// Missing header → 401 AUTH_MISSING_TOKEN (4xx = non-retryable)
	const noKey = await handler(makeUnauthRequest(method, path));
	expect(noKey.status).toBe(401);
	const noKeyBody = (await parseJson(noKey)) as { error: { code: string } };
	expect(noKeyBody.error.code).toBe(EMITO_ERROR_CODE.AUTH_MISSING_TOKEN);

	// Wrong key → 401 AUTH_INVALID_API_KEY
	const wrongKey = await handler(makeWrongKeyRequest(method, path));
	expect(wrongKey.status).toBe(401);
	const wrongKeyBody = (await parseJson(wrongKey)) as { error: { code: string } };
	expect(wrongKeyBody.error.code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_API_KEY);
}

// ===========================================================================
// Admin — Subscribers
// ===========================================================================

describe("admin subscriber endpoints", () => {
	let subscriberRepo: InMemorySubscriberRepository;
	let handler: (req: Request) => Promise<Response>;

	beforeEach(() => {
		const ctx = makeServer();
		subscriberRepo = ctx.subscriberRepo;
		handler = ctx.server.handler;
	});

	// Reset all mocks after each test
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("GET /admin/subscribers", () => {
		it("should return empty list when no subscribers exist", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/subscribers"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toEqual([]);
		});

		it("should return list of subscribers", async () => {
			seedSubscriber(subscriberRepo, { id: "sub_1" });
			seedSubscriber(subscriberRepo, { id: "sub_2", email: "user2@example.com" });

			const res = await handler(makeAdminRequest("GET", "/admin/subscribers"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toHaveLength(2);
		});

		it("should return collection envelope with hasMore", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/subscribers"));
			const body = (await parseJson(res)) as { data: Record<string, unknown> };
			expect(body.data).toHaveProperty("items");
			expect(body.data).toHaveProperty("hasMore");
		});

		it("should require API key auth — 4xx status confirms non-retryable", async () => {
			await assertAdminAuthRequired(handler, "GET", "/admin/subscribers");
		});
	});

	describe("GET /admin/subscribers/:id", () => {
		it("should return subscriber by id", async () => {
			seedSubscriber(subscriberRepo);

			const res = await handler(makeAdminRequest("GET", "/admin/subscribers/sub_1"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { id: string } };
			expect(body.data.id).toBe("sub_1");
		});

		it("should return 404 for unknown subscriber — non-retryable", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/subscribers/sub_unknown"));
			expect(res.status).toBe(404);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe(EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND);
			// 4xx is non-retryable at the HTTP boundary
			expect(res.status).toBeLessThan(500);
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "GET", "/admin/subscribers/sub_1");
		});
	});

	describe("POST /admin/subscribers", () => {
		it("should create a new subscriber", async () => {
			const res = await handler(
				makeAdminRequest("POST", "/admin/subscribers", buildSubscriberData()),
			);
			expect(res.status).toBe(201);
			const body = (await parseJson(res)) as { data: { id: string } };
			expect(body.data.id).toBe("sub_1");
		});

		it("should upsert an existing subscriber", async () => {
			seedSubscriber(subscriberRepo);

			const res = await handler(
				makeAdminRequest(
					"POST",
					"/admin/subscribers",
					buildSubscriberData({ email: "updated@example.com" }),
				),
			);
			expect([200, 201]).toContain(res.status);
		});

		it("should return 400 when id is missing", async () => {
			const res = await handler(
				makeAdminRequest("POST", "/admin/subscribers", { email: "no-id@example.com" }),
			);
			expect(res.status).toBe(400);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "POST", "/admin/subscribers");
		});
	});

	describe("POST /admin/subscribers/:id/erase", () => {
		it("should erase subscriber PII (email, phone cleared; erasedAt set)", async () => {
			seedSubscriber(subscriberRepo);

			const res = await handler(makeAdminRequest("POST", "/admin/subscribers/sub_1/erase"));
			expect(res.status).toBe(200);

			// Re-fetch and verify PII fields cleared
			const getRes = await handler(makeAdminRequest("GET", "/admin/subscribers/sub_1"));
			const body = (await parseJson(getRes)) as {
				data: { email?: string; phone?: string; erasedAt?: string };
			};
			expect(body.data.email).toBeUndefined();
			expect(body.data.phone).toBeUndefined();
			expect(body.data.erasedAt).toBeDefined();
		});

		it("should return 404 for unknown subscriber — non-retryable", async () => {
			const res = await handler(makeAdminRequest("POST", "/admin/subscribers/sub_unknown/erase"));
			expect(res.status).toBe(404);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe(EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND);
			expect(res.status).toBeLessThan(500);
		});

		it("should not include PII in error response context", async () => {
			const res = await handler(makeAdminRequest("POST", "/admin/subscribers/sub_ghost/erase"));
			const body = (await parseJson(res)) as { error: Record<string, unknown> };
			const details = body.error.details as Record<string, unknown> | undefined;
			if (details) {
				expect(details).not.toHaveProperty("email");
				expect(details).not.toHaveProperty("phone");
			}
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "POST", "/admin/subscribers/sub_1/erase");
		});
	});
});

// ===========================================================================
// Admin — Notifications (cross-workspace log)
// ===========================================================================

describe("admin notification endpoints", () => {
	let notificationRepo: InMemoryNotificationRepository;
	let handler: (req: Request) => Promise<Response>;

	beforeEach(() => {
		const ctx = makeServer();
		notificationRepo = ctx.notificationRepo;
		handler = ctx.server.handler;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("GET /admin/notifications", () => {
		it("should return empty list when no notifications", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/notifications"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toEqual([]);
		});

		it("should return notifications spanning multiple workspaces", async () => {
			await notificationRepo.create({
				subscriberId: "sub_1",
				workspaceId: "ws_1",
				eventType: "order.placed",
				category: "transactional",
				channel: "email",
			});
			await notificationRepo.create({
				subscriberId: "sub_2",
				workspaceId: "ws_2",
				eventType: "promo.sent",
				category: "marketing",
				channel: "email",
			});

			const res = await handler(makeAdminRequest("GET", "/admin/notifications"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toHaveLength(2);
		});

		it("should return collection envelope with hasMore", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/notifications"));
			const body = (await parseJson(res)) as { data: Record<string, unknown> };
			expect(body.data).toHaveProperty("items");
			expect(body.data).toHaveProperty("hasMore");
		});

		it("should require API key auth — 4xx confirms non-retryable", async () => {
			await assertAdminAuthRequired(handler, "GET", "/admin/notifications");
		});
	});
});

// ===========================================================================
// Admin — Dead Letters
// ===========================================================================

describe("admin dead-letter endpoints", () => {
	let deadLetterRepo: InMemoryDeadLetterRepository;
	let mockEmito: Emito;
	let handler: (req: Request) => Promise<Response>;

	beforeEach(() => {
		const ctx = makeServer();
		deadLetterRepo = ctx.deadLetterRepo;
		mockEmito = ctx.mockEmito;
		handler = ctx.server.handler;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("GET /admin/dead-letters", () => {
		it("should return empty list when no dead letters", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/dead-letters"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toEqual([]);
		});

		it("should return unresolved dead letters", async () => {
			await seedDeadLetter(deadLetterRepo);
			await seedDeadLetter(deadLetterRepo);

			const res = await handler(makeAdminRequest("GET", "/admin/dead-letters"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toHaveLength(2);
		});

		it("should return collection envelope with hasMore", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/dead-letters"));
			const body = (await parseJson(res)) as { data: Record<string, unknown> };
			expect(body.data).toHaveProperty("items");
			expect(body.data).toHaveProperty("hasMore");
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "GET", "/admin/dead-letters");
		});
	});

	describe("POST /admin/dead-letters/:id/retry", () => {
		it("should call emito.send() and resolve the dead letter as 'retried'", async () => {
			const dl = await seedDeadLetter(deadLetterRepo);

			const res = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
			expect(res.status).toBe(200);

			expect(mockEmito.send).toHaveBeenCalledWith(
				expect.objectContaining({ event: "order.placed" }),
			);

			const updated = await deadLetterRepo.findById(dl.id);
			expect(updated?.resolvedAt).toBeDefined();
			expect(updated?.resolution).toBe("retried");
		});

		it("should not resolve dead letter when emito.send() throws", async () => {
			vi.mocked(mockEmito.send).mockRejectedValueOnce(new Error("provider down"));
			const dl = await seedDeadLetter(deadLetterRepo);

			const res = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
			// Send failure → non-2xx
			expect(res.status).toBeGreaterThanOrEqual(400);

			const updated = await deadLetterRepo.findById(dl.id);
			expect(updated?.resolvedAt).toBeUndefined();
		});

		it("should return 404 for unknown dead letter — non-retryable", async () => {
			const res = await handler(makeAdminRequest("POST", "/admin/dead-letters/dlq_unknown/retry"));
			expect(res.status).toBe(404);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe(EMITO_ERROR_CODE.DEAD_LETTER_NOT_FOUND);
			expect(res.status).toBeLessThan(500);
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "POST", "/admin/dead-letters/dlq_1/retry");
		});
	});

	describe("POST /admin/dead-letters/:id/discard", () => {
		it("should resolve dead letter as 'discarded' without calling emito.send()", async () => {
			const dl = await seedDeadLetter(deadLetterRepo);

			const res = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/discard`));
			expect(res.status).toBe(200);

			expect(mockEmito.send).not.toHaveBeenCalled();

			const updated = await deadLetterRepo.findById(dl.id);
			expect(updated?.resolvedAt).toBeDefined();
			expect(updated?.resolution).toBe("discarded");
		});

		it("should return 404 for unknown dead letter — non-retryable", async () => {
			const res = await handler(
				makeAdminRequest("POST", "/admin/dead-letters/dlq_unknown/discard"),
			);
			expect(res.status).toBe(404);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe(EMITO_ERROR_CODE.DEAD_LETTER_NOT_FOUND);
			expect(res.status).toBeLessThan(500);
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "POST", "/admin/dead-letters/dlq_1/discard");
		});
	});
});

// ===========================================================================
// Admin — Suppression
// ===========================================================================

describe("admin suppression endpoints", () => {
	let suppressionRepo: InMemorySuppressionRepository;
	let handler: (req: Request) => Promise<Response>;

	beforeEach(() => {
		const ctx = makeServer();
		suppressionRepo = ctx.suppressionRepo;
		handler = ctx.server.handler;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("GET /admin/suppression", () => {
		it("should return empty list when no suppression records", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/suppression"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toEqual([]);
		});

		it("should return active suppression records", async () => {
			await seedSuppression(suppressionRepo);
			await suppressionRepo.create({
				address: "bounced2@example.com",
				channel: "email",
				reason: "complaint",
			});

			const res = await handler(makeAdminRequest("GET", "/admin/suppression"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toHaveLength(2);
		});

		it("should exclude archived records by default", async () => {
			const sup = await seedSuppression(suppressionRepo);
			await suppressionRepo.archive(sup.address, sup.channel);

			const res = await handler(makeAdminRequest("GET", "/admin/suppression"));
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toHaveLength(0);
		});

		it("should return collection envelope with hasMore", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/suppression"));
			const body = (await parseJson(res)) as { data: Record<string, unknown> };
			expect(body.data).toHaveProperty("items");
			expect(body.data).toHaveProperty("hasMore");
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "GET", "/admin/suppression");
		});
	});

	describe("POST /admin/suppression", () => {
		it("should add a suppression record", async () => {
			const res = await handler(
				makeAdminRequest("POST", "/admin/suppression", {
					address: "manual@example.com",
					channel: "email",
					reason: "manual",
				}),
			);
			expect(res.status).toBe(201);
			const body = (await parseJson(res)) as { data: { address: string; channel: string } };
			expect(body.data).toMatchObject({ address: "manual@example.com", channel: "email" });
		});

		it("should return 400 when address is missing", async () => {
			const res = await handler(
				makeAdminRequest("POST", "/admin/suppression", { channel: "email", reason: "manual" }),
			);
			expect(res.status).toBe(400);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should return 400 when channel is invalid", async () => {
			const res = await handler(
				makeAdminRequest("POST", "/admin/suppression", {
					address: "test@example.com",
					channel: "carrier_pigeon",
					reason: "manual",
				}),
			);
			expect(res.status).toBe(400);
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "POST", "/admin/suppression");
		});
	});

	describe("POST /admin/suppression/:id/archive", () => {
		it("should archive an active suppression record", async () => {
			const sup = await seedSuppression(suppressionRepo);

			const res = await handler(makeAdminRequest("POST", `/admin/suppression/${sup.id}/archive`));
			expect(res.status).toBe(200);

			// Record excluded from active list after archive
			const listRes = await handler(makeAdminRequest("GET", "/admin/suppression"));
			const body = (await parseJson(listRes)) as { data: { items: unknown[] } };
			expect(body.data.items).toHaveLength(0);
		});

		it("should return 404 for unknown suppression id — non-retryable", async () => {
			const res = await handler(makeAdminRequest("POST", "/admin/suppression/sup_unknown/archive"));
			expect(res.status).toBe(404);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe(EMITO_ERROR_CODE.SUPPRESSION_NOT_FOUND);
			expect(res.status).toBeLessThan(500);
		});

		it("should use POST .../archive not DELETE", async () => {
			// DELETE /admin/suppression/:id must not be a registered route
			const deleteRes = await handler(makeAdminRequest("DELETE", "/admin/suppression/sup_1"));
			expect([404, 405]).toContain(deleteRes.status);
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "POST", "/admin/suppression/sup_1/archive");
		});
	});
});

// ===========================================================================
// Admin — Workspace Management
// ===========================================================================

describe("admin workspace management endpoints", () => {
	let integrationRepo: InMemoryIntegrationRepository;
	let workspaceDefaultRepo: InMemoryWorkspaceDefaultRepository;
	let handler: (req: Request) => Promise<Response>;

	beforeEach(() => {
		const ctx = makeServer();
		integrationRepo = ctx.integrationRepo;
		workspaceDefaultRepo = ctx.workspaceDefaultRepo;
		handler = ctx.server.handler;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("GET /admin/workspaces/:id/integrations", () => {
		it("should return empty list for workspace with no integrations", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/workspaces/ws_1/integrations"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toEqual([]);
		});

		it("should return only integrations belonging to the requested workspace", async () => {
			integrationRepo.seed({
				id: "int_1",
				ownerId: "ws_1",
				channel: "email",
				config: {},
				active: true,
				createdAt: new Date("2026-01-01T00:00:00Z"),
			});
			integrationRepo.seed({
				id: "int_2",
				ownerId: "ws_2",
				channel: "sms",
				config: {},
				active: true,
				createdAt: new Date("2026-01-01T00:00:00Z"),
			});

			const res = await handler(makeAdminRequest("GET", "/admin/workspaces/ws_1/integrations"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: Array<{ id: string }> } };
			expect(body.data.items).toHaveLength(1);
			expect(body.data.items[0]!.id).toBe("int_1");
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "GET", "/admin/workspaces/ws_1/integrations");
		});
	});

	describe("POST /admin/workspaces/:id/integrations", () => {
		it("should add an integration to the specified workspace", async () => {
			const res = await handler(
				makeAdminRequest("POST", "/admin/workspaces/ws_1/integrations", {
					channel: "email",
					config: { apiKey: "sg-key" },
				}),
			);
			expect(res.status).toBe(201);
			const body = (await parseJson(res)) as { data: { ownerId: string; channel: string } };
			expect(body.data).toMatchObject({ ownerId: "ws_1", channel: "email" });
		});

		it("should return 400 when channel is missing", async () => {
			const res = await handler(
				makeAdminRequest("POST", "/admin/workspaces/ws_1/integrations", { config: {} }),
			);
			expect(res.status).toBe(400);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "POST", "/admin/workspaces/ws_1/integrations");
		});
	});

	describe("GET /admin/workspaces/:id/defaults", () => {
		it("should return empty list for workspace with no defaults", async () => {
			const res = await handler(makeAdminRequest("GET", "/admin/workspaces/ws_1/defaults"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toEqual([]);
		});

		it("should return defaults scoped to the specified workspace", async () => {
			workspaceDefaultRepo.seed({
				workspaceId: "ws_1",
				topicKey: "order.placed",
				channel: "email",
				enabled: true,
			} as Parameters<typeof workspaceDefaultRepo.seed>[0]);

			const res = await handler(makeAdminRequest("GET", "/admin/workspaces/ws_1/defaults"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as {
				data: { items: Array<{ workspaceId: string }> };
			};
			expect(body.data.items).toHaveLength(1);
			expect(body.data.items[0]!.workspaceId).toBe("ws_1");
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "GET", "/admin/workspaces/ws_1/defaults");
		});
	});

	describe("PUT /admin/workspaces/:id/defaults", () => {
		it("should set defaults for the specified workspace", async () => {
			const res = await handler(
				makeAdminRequest("PUT", "/admin/workspaces/ws_1/defaults", {
					topicKey: "order.placed",
					channel: "email",
					enabled: false,
				}),
			);
			expect(res.status).toBe(200);
		});

		it("should return 400 when topicKey is missing", async () => {
			const res = await handler(
				makeAdminRequest("PUT", "/admin/workspaces/ws_1/defaults", {
					channel: "email",
					enabled: false,
				}),
			);
			expect(res.status).toBe(400);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should require API key auth", async () => {
			await assertAdminAuthRequired(handler, "PUT", "/admin/workspaces/ws_1/defaults");
		});
	});
});

// ===========================================================================
// Admin — API key auth security
// ===========================================================================

describe("admin API key security", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should reject missing X-Emito-Admin-Key with AUTH_MISSING_TOKEN", async () => {
		const { server } = makeServer();
		const res = await server.handler(
			new Request(`http://localhost${API_BASE}/admin/subscribers`, { method: "GET" }),
		);
		expect(res.status).toBe(401);
		const body = (await parseJson(res)) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.AUTH_MISSING_TOKEN);
	});

	it("should reject wrong API key with AUTH_INVALID_API_KEY", async () => {
		const { server } = makeServer();
		const res = await server.handler(
			new Request(`http://localhost${API_BASE}/admin/subscribers`, {
				method: "GET",
				headers: { "x-emito-admin-key": "wrong-key" },
			}),
		);
		expect(res.status).toBe(401);
		const body = (await parseJson(res)) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_API_KEY);
	});

	it("should accept correct API key", async () => {
		const { server } = makeServer();
		const res = await server.handler(makeAdminRequest("GET", "/admin/subscribers"));
		expect(res.status).not.toBe(401);
	});
});

// ===========================================================================
// Admin — Zod validation (assert codes, not messages)
// ===========================================================================

describe("admin Zod validation", () => {
	let handler: (req: Request) => Promise<Response>;

	beforeEach(() => {
		handler = makeServer().server.handler;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should return VALIDATION_ERROR code with field-level details array", async () => {
		const res = await handler(
			makeAdminRequest("POST", "/admin/subscribers", {}), // missing required `id`
		);
		expect(res.status).toBe(400);
		const body = (await parseJson(res)) as {
			error: { code: string; details: Array<{ path: string; message: string }> };
		};
		expect(body.error.code).toBe("VALIDATION_ERROR");
		expect(Array.isArray(body.error.details)).toBe(true);
		expect(body.error.details.length).toBeGreaterThan(0);
		const idError = body.error.details.find((d) => d.path.includes("id"));
		expect(idError).toBeDefined();
	});
});
