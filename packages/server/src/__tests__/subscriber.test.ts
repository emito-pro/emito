/**
 * Tests for the 14 subscriber endpoints:
 *   - Notifications: list, unread-count, read, unread, archive, unarchive, snooze, read-all
 *   - Preferences: get, put, reset
 *   - Integrations: list, add, update, deactivate
 *
 * Tests exercise the full HTTP handler pipeline via createEmitoServer.
 * All repositories are in-memory stubs; no real network or DB is used.
 *
 * Behaviour notes:
 *   - GET /integrations returns { data: { integrations: [...] } }, not a collection envelope.
 *   - PUT/deactivate integrations has no subscriber ownership check (no 403 for another subscriber).
 */

import { createHmac } from "node:crypto";
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
import type { IntegrationRecord } from "@emito/core";
import type { CreateInboxData } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import type { PreferenceRecord, ResolveSubscriberId } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyHS256 } from "../auth/hs256.js";
import { createEmitoServer } from "../handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JWT_SECRET = "test-secret-key-at-least-32-chars-long";
const SUBSCRIBER_ID = "sub_1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJwt(): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify({ subscriberId: SUBSCRIBER_ID })).toString("base64url");
	const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${sig}`;
}

function authHeader(): Record<string, string> {
	return { Authorization: `Bearer ${makeJwt()}` };
}

function createTestResolveSubscriberId(secret: string): ResolveSubscriberId {
	return async (req: Request): Promise<string | null> => {
		const auth = req.headers.get("authorization");
		if (!auth?.startsWith("Bearer ")) return null;
		try {
			const payload = verifyHS256(auth.slice(7), secret);
			const id = payload.subscriberId;
			return typeof id === "string" && id ? id : null;
		} catch {
			return null;
		}
	};
}

async function parseBody(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

function makeRequest(
	method: string,
	path: string,
	opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			...(opts.headers ?? {}),
		},
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
	});
}

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function inboxData(overrides: Partial<CreateInboxData> = {}): CreateInboxData {
	return {
		subscriberId: SUBSCRIBER_ID,
		workspaceId: "ws_1",
		eventType: "user.welcome",
		category: "transactional",
		body: "Hello world",
		...overrides,
	};
}

function createSubscriberIntegration(
	overrides: Partial<IntegrationRecord> = {},
): IntegrationRecord {
	return {
		id: "int_1",
		ownerId: SUBSCRIBER_ID,
		subscriberId: SUBSCRIBER_ID,
		channel: "email",
		config: { webhookUrl: "https://example.com/hook" },
		active: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function createPreferenceItem(overrides: Partial<PreferenceRecord> = {}): PreferenceRecord {
	return {
		subscriberId: SUBSCRIBER_ID,
		topicKey: "user.welcome",
		channel: "email",
		enabled: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Server + repo setup
// ---------------------------------------------------------------------------

let inboxRepo: InMemoryInboxRepository;
let preferenceRepo: InMemoryPreferenceRepository;
let integrationRepo: InMemoryIntegrationRepository;
let server: ReturnType<typeof createEmitoServer>;

beforeEach(() => {
	inboxRepo = new InMemoryInboxRepository();
	preferenceRepo = new InMemoryPreferenceRepository();
	integrationRepo = new InMemoryIntegrationRepository();

	const mockEmito = {
		send: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		healthCheck: vi.fn().mockResolvedValue({ healthy: true, providers: [], redis: null }),
		on: vi.fn(),
		off: vi.fn(),
		getEventNames: vi.fn().mockReturnValue([]),
		getEvent: vi.fn(),
	};

	server = createEmitoServer({
		emito: mockEmito as never,
		apiKey: "admin-key",
		resolveSubscriberId: createTestResolveSubscriberId(JWT_SECRET),
		repositories: {
			inboxRepository: inboxRepo,
			preferenceRepository: preferenceRepo,
			consentRepository: new InMemoryConsentRepository(),
			integrationRepository: integrationRepo,
			notificationRepository: new InMemoryNotificationRepository(),
			subscriberRepository: new InMemorySubscriberRepository(),
			deadLetterRepository: new InMemoryDeadLetterRepository(),
			suppressionRepository: new InMemorySuppressionRepository(),
			workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
		},
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auth guard helper
// ---------------------------------------------------------------------------

async function assertRequiresAuth(method: string, path: string, body?: unknown): Promise<void> {
	const req = makeRequest(method, path, { body });
	const res = await server.handler(req);
	expect(res.status).toBe(401);
	const b = (await parseBody(res)) as { error: { code: string } };
	expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
}

// ---------------------------------------------------------------------------
// GET /emito/v1/notifications
// ---------------------------------------------------------------------------

describe("GET /emito/v1/notifications", () => {
	it("should return notification items for subscriber", async () => {
		await inboxRepo.create(inboxData());

		const req = makeRequest("GET", "/emito/v1/notifications", { headers: authHeader() });
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { items: unknown[]; hasMore: boolean } };
		expect(b.data.items).toHaveLength(1);
		expect(b.data.hasMore).toBe(false);
	});

	it("should return empty items when subscriber has no notifications", async () => {
		const req = makeRequest("GET", "/emito/v1/notifications", { headers: authHeader() });
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { items: unknown[] } };
		expect(b.data.items).toEqual([]);
	});

	it("should filter by status=unread", async () => {
		// Create one item then mark it read to ensure we have one unread and one read
		const unread = await inboxRepo.create(inboxData());
		const read = await inboxRepo.create(inboxData());
		await inboxRepo.updateReadAt(read.id);

		const req = makeRequest("GET", "/emito/v1/notifications?status=unread", {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { items: Array<{ id: string }> } };
		expect(b.data.items).toHaveLength(1);
		expect(b.data.items[0]!.id).toBe(unread.id);
	});

	it("should filter by status=archived", async () => {
		const archived = await inboxRepo.create(inboxData());
		await inboxRepo.create(inboxData()); // active
		await inboxRepo.updateArchivedAt(archived.id);

		const req = makeRequest("GET", "/emito/v1/notifications?status=archived", {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { items: Array<{ id: string }> } };
		expect(b.data.items).toHaveLength(1);
		expect(b.data.items[0]!.id).toBe(archived.id);
	});

	it("should paginate correctly with limit param", async () => {
		for (let i = 0; i < 5; i++) {
			await inboxRepo.create(inboxData());
		}
		const req = makeRequest("GET", "/emito/v1/notifications?limit=2", { headers: authHeader() });
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { items: unknown[]; hasMore: boolean } };
		expect(b.data.items).toHaveLength(2);
		expect(b.data.hasMore).toBe(true);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("GET", "/emito/v1/notifications");
	});
});

// ---------------------------------------------------------------------------
// GET /emito/v1/notifications/unread/count
// ---------------------------------------------------------------------------

describe("GET /emito/v1/notifications/unread/count", () => {
	it("should return correct unread count", async () => {
		await inboxRepo.create(inboxData());
		await inboxRepo.create(inboxData());

		const req = makeRequest("GET", "/emito/v1/notifications/unread/count", {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { count: number } };
		expect(b.data.count).toBe(2);
	});

	it("should return 0 when all notifications are read", async () => {
		const item = await inboxRepo.create(inboxData());
		await inboxRepo.updateReadAt(item.id);

		const req = makeRequest("GET", "/emito/v1/notifications/unread/count", {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { count: number } };
		expect(b.data.count).toBe(0);
	});

	it("should return 0 when subscriber has no notifications", async () => {
		const req = makeRequest("GET", "/emito/v1/notifications/unread/count", {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { count: number } };
		expect(b.data.count).toBe(0);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("GET", "/emito/v1/notifications/unread/count");
	});
});

// ---------------------------------------------------------------------------
// POST /emito/v1/notifications/:id/read
// ---------------------------------------------------------------------------

describe("POST /emito/v1/notifications/:id/read", () => {
	it("should mark notification as read and return 200", async () => {
		const item = await inboxRepo.create(inboxData());

		const req = makeRequest("POST", `/emito/v1/notifications/${item.id}/read`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const items = inboxRepo.getAll();
		expect(items.find((i) => i.id === item.id)!.readAt).toBeDefined();
	});

	it("should return 404 for unknown notification ID", async () => {
		const req = makeRequest("POST", "/emito/v1/notifications/inbox_unknown/read", {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", "/emito/v1/notifications/inbox_1/read");
	});
});

// ---------------------------------------------------------------------------
// POST /emito/v1/notifications/:id/unread
// ---------------------------------------------------------------------------

describe("POST /emito/v1/notifications/:id/unread", () => {
	it("should clear readAt to mark notification as unread", async () => {
		const item = await inboxRepo.create(inboxData());
		await inboxRepo.updateReadAt(item.id);

		const req = makeRequest("POST", `/emito/v1/notifications/${item.id}/unread`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const items = inboxRepo.getAll();
		expect(items.find((i) => i.id === item.id)!.readAt).toBeUndefined();
	});

	it("should return 404 for unknown notification ID", async () => {
		const req = makeRequest("POST", "/emito/v1/notifications/inbox_nope/unread", {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", "/emito/v1/notifications/inbox_1/unread");
	});
});

// ---------------------------------------------------------------------------
// POST /emito/v1/notifications/:id/archive
// ---------------------------------------------------------------------------

describe("POST /emito/v1/notifications/:id/archive", () => {
	it("should set archivedAt and return 200", async () => {
		const item = await inboxRepo.create(inboxData());

		const req = makeRequest("POST", `/emito/v1/notifications/${item.id}/archive`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const items = inboxRepo.getAll();
		expect(items.find((i) => i.id === item.id)!.archivedAt).toBeDefined();
	});

	it("should return 404 for unknown notification ID", async () => {
		const req = makeRequest("POST", "/emito/v1/notifications/inbox_nope/archive", {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", "/emito/v1/notifications/inbox_1/archive");
	});
});

// ---------------------------------------------------------------------------
// POST /emito/v1/notifications/:id/unarchive
// ---------------------------------------------------------------------------

describe("POST /emito/v1/notifications/:id/unarchive", () => {
	it("should clear archivedAt and return 200", async () => {
		const item = await inboxRepo.create(inboxData());
		await inboxRepo.updateArchivedAt(item.id);

		const req = makeRequest("POST", `/emito/v1/notifications/${item.id}/unarchive`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const items = inboxRepo.getAll();
		expect(items.find((i) => i.id === item.id)!.archivedAt).toBeUndefined();
	});

	it("should return 404 for unknown notification ID", async () => {
		const req = makeRequest("POST", "/emito/v1/notifications/inbox_nope/unarchive", {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", "/emito/v1/notifications/inbox_1/unarchive");
	});
});

// ---------------------------------------------------------------------------
// POST /emito/v1/notifications/:id/snooze
// ---------------------------------------------------------------------------

describe("POST /emito/v1/notifications/:id/snooze", () => {
	it("should set snoozedUntil from until field in body and return 200", async () => {
		const item = await inboxRepo.create(inboxData());

		const req = makeRequest("POST", `/emito/v1/notifications/${item.id}/snooze`, {
			headers: authHeader(),
			body: { until: "2026-06-01T00:00:00Z" },
		});
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const items = inboxRepo.getAll();
		expect(items.find((i) => i.id === item.id)!.snoozedUntil).toBeDefined();
	});

	it("should return 400 when until field is missing", async () => {
		const item = await inboxRepo.create(inboxData());

		const req = makeRequest("POST", `/emito/v1/notifications/${item.id}/snooze`, {
			headers: authHeader(),
			body: {},
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 400 when until is not a coercible date string", async () => {
		const item = await inboxRepo.create(inboxData());

		const req = makeRequest("POST", `/emito/v1/notifications/${item.id}/snooze`, {
			headers: authHeader(),
			body: { until: "not-a-date" },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 404 for unknown notification ID", async () => {
		const req = makeRequest("POST", "/emito/v1/notifications/inbox_nope/snooze", {
			headers: authHeader(),
			body: { until: "2026-06-01T00:00:00Z" },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", "/emito/v1/notifications/inbox_1/snooze", {
			until: "2026-06-01T00:00:00Z",
		});
	});
});

// ---------------------------------------------------------------------------
// POST /emito/v1/notifications/read-all
// ---------------------------------------------------------------------------

describe("POST /emito/v1/notifications/read-all", () => {
	it("should mark all unread notifications as read and return 200", async () => {
		await inboxRepo.create(inboxData());
		await inboxRepo.create(inboxData());

		const req = makeRequest("POST", "/emito/v1/notifications/read-all", { headers: authHeader() });
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const items = inboxRepo.getAll();
		expect(items.every((i) => i.readAt != null)).toBe(true);
	});

	it("should be idempotent when all notifications are already read", async () => {
		const item = await inboxRepo.create(inboxData());
		await inboxRepo.updateReadAt(item.id);

		const req = makeRequest("POST", "/emito/v1/notifications/read-all", { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 200 when subscriber has no notifications", async () => {
		const req = makeRequest("POST", "/emito/v1/notifications/read-all", { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", "/emito/v1/notifications/read-all");
	});
});

// ---------------------------------------------------------------------------
// GET /emito/v1/preferences
// ---------------------------------------------------------------------------

describe("GET /emito/v1/preferences", () => {
	it("should return subscriber's global preferences", async () => {
		preferenceRepo.seed(createPreferenceItem());

		const req = makeRequest("GET", "/emito/v1/preferences", { headers: authHeader() });
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { preferences: unknown[] } };
		expect(Array.isArray(b.data.preferences)).toBe(true);
	});

	it("should return empty preferences list when subscriber has none", async () => {
		const req = makeRequest("GET", "/emito/v1/preferences", { headers: authHeader() });
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { preferences: unknown[] } };
		expect(b.data.preferences).toEqual([]);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("GET", "/emito/v1/preferences");
	});
});

// ---------------------------------------------------------------------------
// PUT /emito/v1/preferences
// ---------------------------------------------------------------------------

describe("PUT /emito/v1/preferences", () => {
	it("should upsert a preference and return 200", async () => {
		const req = makeRequest("PUT", "/emito/v1/preferences", {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "email", enabled: false },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 400 when channel is an invalid enum value", async () => {
		const req = makeRequest("PUT", "/emito/v1/preferences", {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "fax", enabled: true },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe("VALIDATION_ERROR");
	});

	it("should return 400 when topicKey is missing", async () => {
		const req = makeRequest("PUT", "/emito/v1/preferences", {
			headers: authHeader(),
			body: { channel: "email", enabled: true },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 400 when enabled is missing", async () => {
		const req = makeRequest("PUT", "/emito/v1/preferences", {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "email" },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("PUT", "/emito/v1/preferences", {
			topicKey: "user.welcome",
			channel: "email",
			enabled: true,
		});
	});
});

// ---------------------------------------------------------------------------
// POST /emito/v1/preferences/reset
// ---------------------------------------------------------------------------

describe("POST /emito/v1/preferences/reset", () => {
	it("should reset global preferences and return 200", async () => {
		preferenceRepo.seed(createPreferenceItem());

		const req = makeRequest("POST", "/emito/v1/preferences/reset", { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 200 when subscriber has no preferences to reset", async () => {
		const req = makeRequest("POST", "/emito/v1/preferences/reset", { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", "/emito/v1/preferences/reset");
	});
});

// ---------------------------------------------------------------------------
// GET /emito/v1/integrations
// ---------------------------------------------------------------------------

describe("GET /emito/v1/integrations", () => {
	it("should return collection of subscriber's active integrations", async () => {
		integrationRepo.seed(createSubscriberIntegration());

		const req = makeRequest("GET", "/emito/v1/integrations", { headers: authHeader() });
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { items: unknown[]; hasMore: boolean } };
		expect(b.data.items).toHaveLength(1);
		expect(b.data.hasMore).toBe(false);
	});

	it("should return empty items when subscriber has no integrations", async () => {
		const req = makeRequest("GET", "/emito/v1/integrations", { headers: authHeader() });
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { items: unknown[] } };
		expect(b.data.items).toEqual([]);
	});

	it("should not return inactive integrations", async () => {
		integrationRepo.seed(createSubscriberIntegration({ id: "int_1", active: true }));
		integrationRepo.seed(createSubscriberIntegration({ id: "int_2", active: false }));

		const req = makeRequest("GET", "/emito/v1/integrations", { headers: authHeader() });
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { items: Array<{ id: string }> } };
		expect(b.data.items).toHaveLength(1);
		expect(b.data.items[0]!.id).toBe("int_1");
	});

	it("should not return integrations belonging to other subscribers", async () => {
		integrationRepo.seed(createSubscriberIntegration({ subscriberId: "sub_999" }));

		const req = makeRequest("GET", "/emito/v1/integrations", { headers: authHeader() });
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { items: unknown[] } };
		expect(b.data.items).toEqual([]);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("GET", "/emito/v1/integrations");
	});
});

// ---------------------------------------------------------------------------
// POST /emito/v1/integrations
// ---------------------------------------------------------------------------

describe("POST /emito/v1/integrations", () => {
	it("should create a new integration and return 201", async () => {
		const req = makeRequest("POST", "/emito/v1/integrations", {
			headers: authHeader(),
			body: { channel: "email", config: { webhookUrl: "https://example.com/hook" } },
		});
		const res = await server.handler(req);

		expect(res.status).toBe(201);
		const b = (await parseBody(res)) as { data: { id: string; channel: string } };
		expect(b.data.id).toMatch(/^int_/);
		expect(b.data.channel).toBe("email");
	});

	it("should return 400 when channel is missing from body", async () => {
		const req = makeRequest("POST", "/emito/v1/integrations", {
			headers: authHeader(),
			body: { config: {} },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 400 when channel is an invalid enum value", async () => {
		const req = makeRequest("POST", "/emito/v1/integrations", {
			headers: authHeader(),
			body: { channel: "carrier-pigeon", config: {} },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe("VALIDATION_ERROR");
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", "/emito/v1/integrations", {
			channel: "email",
			config: {},
		});
	});
});

// ---------------------------------------------------------------------------
// PUT /emito/v1/integrations/:id
// ---------------------------------------------------------------------------

describe("PUT /emito/v1/integrations/:id", () => {
	it("should update an existing integration and return 200", async () => {
		integrationRepo.seed(createSubscriberIntegration({ id: "int_1" }));

		const req = makeRequest("PUT", "/emito/v1/integrations/int_1", {
			headers: authHeader(),
			body: { config: { webhookUrl: "https://new.example.com/hook" } },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 404 for unknown integration ID", async () => {
		const req = makeRequest("PUT", "/emito/v1/integrations/int_nope", {
			headers: authHeader(),
			body: { config: {} },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	it("should return 403 when integration belongs to another subscriber", async () => {
		// ownerId must match subscriberId — requireOwnership checks ownerId
		integrationRepo.seed(
			createSubscriberIntegration({ id: "int_other", ownerId: "sub_999", subscriberId: "sub_999" }),
		);

		const req = makeRequest("PUT", "/emito/v1/integrations/int_other", {
			headers: authHeader(),
			body: { config: {} },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("PUT", "/emito/v1/integrations/int_1", { config: {} });
	});
});

// ---------------------------------------------------------------------------
// POST /emito/v1/integrations/:id/deactivate
// ---------------------------------------------------------------------------

describe("POST /emito/v1/integrations/:id/deactivate", () => {
	it("should deactivate an integration and return 200", async () => {
		integrationRepo.seed(createSubscriberIntegration({ id: "int_1" }));

		const req = makeRequest("POST", "/emito/v1/integrations/int_1/deactivate", {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const active = await integrationRepo.listBySubscriber(SUBSCRIBER_ID);
		expect(active.find((i) => i.id === "int_1")).toBeUndefined();
	});

	it("should return 404 for unknown integration ID", async () => {
		const req = makeRequest("POST", "/emito/v1/integrations/int_nope/deactivate", {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	it("should return 403 when integration belongs to another subscriber", async () => {
		// ownerId must match subscriberId — requireOwnership checks ownerId
		integrationRepo.seed(
			createSubscriberIntegration({ id: "int_other", ownerId: "sub_999", subscriberId: "sub_999" }),
		);

		const req = makeRequest("POST", "/emito/v1/integrations/int_other/deactivate", {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", "/emito/v1/integrations/int_1/deactivate");
	});
});

// ---------------------------------------------------------------------------
// Pagination boundary validation
// ---------------------------------------------------------------------------

describe("pagination limit validation", () => {
	it("should return 400 when limit=0", async () => {
		const req = makeRequest("GET", "/emito/v1/notifications?limit=0", { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 400 when limit=1001", async () => {
		const req = makeRequest("GET", "/emito/v1/notifications?limit=1001", { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should accept limit=1", async () => {
		const req = makeRequest("GET", "/emito/v1/notifications?limit=1", { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should accept limit=1000", async () => {
		const req = makeRequest("GET", "/emito/v1/notifications?limit=1000", { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});
});
