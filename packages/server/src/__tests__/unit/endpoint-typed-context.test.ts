/**
 * Tests for endpoint handlers consuming a typed request context.
 *
 * Covers:
 *   1. Endpoint handlers use ctx.body/ctx.query/ctx.params directly (no re-parse),
 *      verified by asserting on Zod transform outputs (coerced/transformed values)
 *      that only appear if the central parse result flows through to the handler.
 *   2. subscriberId is present and non-optional on subscriber/workspace handlers,
 *      verified by confirming subscriber-scoped endpoints use the subscriberId from
 *      context.
 *
 * These tests prove that schemas with transforms produce the expected transformed
 * output in responses. The structural guarantees (no re-parse, no `as` casts) are
 * enforced separately by biome + tsc; router-typed-context.test.ts checks that the
 * type system infers handler context correctly.
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
import type { Emito } from "@emito/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyHS256 } from "../../auth/hs256.js";
import { createEmitoServer } from "../../handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JWT_SECRET = "test-secret-key-at-least-32-chars-long";
const SUBSCRIBER_ID = "sub_typed_ctx_1";
const WORKSPACE_ID = "ws_typed_ctx_1";
const API_KEY = "test-admin-api-key-32-chars-long!!";

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function makeJwt(subscriberId = SUBSCRIBER_ID): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			subscriberId,
			iat: Math.floor(Date.now() / 1000) - 60,
			exp: Math.floor(Date.now() / 1000) + 3600,
		}),
	).toString("base64url");
	const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
	return `${header}.${payload}.${sig}`;
}

function subscriberAuthHeader(subscriberId = SUBSCRIBER_ID): Record<string, string> {
	return { Authorization: `Bearer ${makeJwt(subscriberId)}` };
}

function adminHeader(): Record<string, string> {
	return { "x-emito-admin-key": API_KEY };
}

function jsonAdminHeader(): Record<string, string> {
	return { ...adminHeader(), "content-type": "application/json" };
}

function jsonSubscriberHeader(subscriberId = SUBSCRIBER_ID): Record<string, string> {
	return { ...subscriberAuthHeader(subscriberId), "content-type": "application/json" };
}

async function parseBody(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

function createTestServer(
	resolveWorkspaceRole?: (subscriberId: string, wsId: string) => Promise<"admin" | "member" | null>,
) {
	const subscriberRepo = new InMemorySubscriberRepository();
	const notificationRepo = new InMemoryNotificationRepository();
	const deadLetterRepo = new InMemoryDeadLetterRepository();
	const suppressionRepo = new InMemorySuppressionRepository();
	const integrationRepo = new InMemoryIntegrationRepository();
	const workspaceDefaultRepo = new InMemoryWorkspaceDefaultRepository();
	const inboxRepo = new InMemoryInboxRepository();
	const preferenceRepo = new InMemoryPreferenceRepository();

	const mockEmito: Emito = {
		send: vi.fn().mockResolvedValue({ notificationId: "ntf_001", channels: [] }),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		healthCheck: vi.fn().mockResolvedValue({ healthy: true, providers: [], redis: null }),
		on: vi.fn(),
		off: vi.fn(),
		getEventNames: vi.fn().mockReturnValue([]),
		getEvent: vi.fn(),
	};

	const server = createEmitoServer({
		emito: mockEmito,
		apiKey: API_KEY,
		resolveSubscriberId: async (req: Request): Promise<string | null> => {
			const auth = req.headers.get("authorization");
			if (!auth?.startsWith("Bearer ")) return null;
			try {
				const payload = verifyHS256(auth.slice(7), JWT_SECRET);
				const id = payload.subscriberId;
				return typeof id === "string" && id ? id : null;
			} catch {
				return null;
			}
		},
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
		resolveWorkspaceRole,
	});

	return {
		server,
		subscriberRepo,
		notificationRepo,
		deadLetterRepo,
		suppressionRepo,
		integrationRepo,
		workspaceDefaultRepo,
		inboxRepo,
		preferenceRepo,
	};
}

// ---------------------------------------------------------------------------
// Admin endpoints — typed ctx.query transforms (deadLetterFilterSchema, suppressionFilterSchema)
// ---------------------------------------------------------------------------

describe("Admin endpoint typed context — query coercion transforms", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("GET /admin/dead-letters — deadLetterFilterSchema.resolved boolean coercion", () => {
		it("should return only unresolved items when resolved=false is passed", async () => {
			// Create a resolved dead letter
			const dl = await ctx.deadLetterRepo.create({
				notificationId: "ntf_resolved",
				subscriberId: SUBSCRIBER_ID,
				eventType: "test.event",
				channel: "email",
				attempts: [],
				payload: {},
			});
			await ctx.deadLetterRepo.resolve(dl.id, "discarded");

			// Create an unresolved dead letter
			await ctx.deadLetterRepo.create({
				notificationId: "ntf_unresolved",
				subscriberId: SUBSCRIBER_ID,
				eventType: "test.event",
				channel: "email",
				attempts: [],
				payload: {},
			});

			// resolved=false should return only unresolved items
			// The schema transforms "false" (string) → false (boolean) — coercion must work
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/dead-letters?resolved=false", {
					headers: adminHeader(),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as { data: { items: Array<{ notificationId: string }> } };
			const ids = body.data.items.map((i) => i.notificationId);
			expect(ids).toContain("ntf_unresolved");
			expect(ids).not.toContain("ntf_resolved");
		});

		it("should include both resolved and unresolved items when resolved=true is passed", async () => {
			// Create a resolved dead letter
			const dl = await ctx.deadLetterRepo.create({
				notificationId: "ntf_res_002",
				subscriberId: SUBSCRIBER_ID,
				eventType: "test.event",
				channel: "email",
				attempts: [],
				payload: {},
			});
			await ctx.deadLetterRepo.resolve(dl.id, "retried");

			// Create an unresolved dead letter
			await ctx.deadLetterRepo.create({
				notificationId: "ntf_unres_002",
				subscriberId: SUBSCRIBER_ID,
				eventType: "test.event",
				channel: "email",
				attempts: [],
				payload: {},
			});

			// resolved=true removes the "only unresolved" filter — shows all items
			// The schema transforms "true" (string) → true (boolean) — coercion must work
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/dead-letters?resolved=true", {
					headers: adminHeader(),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as { data: { items: Array<{ notificationId: string }> } };
			const ids = body.data.items.map((i) => i.notificationId);
			// Both resolved and unresolved are included when resolved=true
			expect(ids).toContain("ntf_res_002");
			expect(ids).toContain("ntf_unres_002");
		});

		it("should return all (unresolved by default) when resolved param is omitted", async () => {
			await ctx.deadLetterRepo.create({
				notificationId: "ntf_default_001",
				subscriberId: SUBSCRIBER_ID,
				eventType: "test.event",
				channel: "email",
				attempts: [],
				payload: {},
			});

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/dead-letters", {
					headers: adminHeader(),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toHaveLength(1);
		});
	});

	describe("GET /admin/suppression — suppressionFilterSchema coercion", () => {
		it("should return active suppressions by default (includeArchived omitted)", async () => {
			await ctx.suppressionRepo.create({
				address: "bounce@example.com",
				channel: "email",
				reason: "hard_bounce",
			});

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/suppression", {
					headers: adminHeader(),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as {
				data: { items: Array<{ address: string }> };
			};
			expect(body.data.items.map((i) => i.address)).toContain("bounce@example.com");
		});

		it("should accept cursor query param — limit coercion from string to number", async () => {
			// Create multiple suppressions
			for (let i = 0; i < 5; i++) {
				await ctx.suppressionRepo.create({
					address: `bounce${i}@example.com`,
					channel: "email",
					reason: "hard_bounce",
				});
			}

			// limit=3 — coerced from string "3" to number 3 by the schema
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/suppression?limit=3", {
					headers: adminHeader(),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as {
				data: { items: unknown[] };
			};
			// limit coercion must work — if re-parse failed, the string "3" would not coerce
			expect(body.data.items.length).toBeLessThanOrEqual(3);
		});
	});

	describe("GET /admin/notifications — notificationFilterSchema coercion", () => {
		it("should filter by category", async () => {
			await ctx.notificationRepo.create({
				subscriberId: SUBSCRIBER_ID,
				eventType: "invoice.paid",
				category: "transactional",
				channel: "email",
			});
			await ctx.notificationRepo.create({
				subscriberId: SUBSCRIBER_ID,
				eventType: "promo",
				category: "marketing",
				channel: "email",
			});

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/notifications?category=transactional", {
					headers: adminHeader(),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as {
				data: { items: Array<{ category: string }> };
			};
			expect(body.data.items).toHaveLength(1);
			expect(body.data.items[0]!.category).toBe("transactional");
		});

		it("should apply limit coercion from string to number", async () => {
			for (let i = 0; i < 5; i++) {
				await ctx.notificationRepo.create({
					subscriberId: SUBSCRIBER_ID,
					eventType: `event.${i}`,
					category: "transactional",
					channel: "email",
				});
			}

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/notifications?limit=2", {
					headers: adminHeader(),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as { data: { items: unknown[] } };
			expect(body.data.items.length).toBeLessThanOrEqual(2);
		});
	});
});

// ---------------------------------------------------------------------------
// Admin endpoints — typed ctx.body (createSubscriberBodySchema, createSuppressionBodySchema)
// ---------------------------------------------------------------------------

describe("Admin endpoint typed context — body parsing", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("POST /admin/subscribers — createSubscriberBodySchema", () => {
		it("should create subscriber using typed ctx.body fields", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/subscribers", {
					method: "POST",
					headers: jsonAdminHeader(),
					body: JSON.stringify({
						id: "sub_typed_001",
						email: "typed@example.com",
						lang: "en",
						timezone: "Europe/Warsaw",
					}),
				}),
			);

			expect(res.status).toBe(201);
			const body = (await parseBody(res)) as {
				data: { id: string; email: string; lang?: string; timezone?: string };
			};
			expect(body.data).toMatchObject({
				id: "sub_typed_001",
				email: "typed@example.com",
			});
		});

		it("should reject invalid body (schema validation from central parse)", async () => {
			// id is required — missing id should return 400
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/subscribers", {
					method: "POST",
					headers: jsonAdminHeader(),
					body: JSON.stringify({ email: "noid@example.com" }),
				}),
			);

			expect(res.status).toBe(400);
		});
	});

	describe("POST /admin/suppression — createSuppressionBodySchema", () => {
		it("should add suppression using typed ctx.body fields", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/suppression", {
					method: "POST",
					headers: jsonAdminHeader(),
					body: JSON.stringify({
						address: "typed-suppression@example.com",
						channel: "email",
						reason: "manual_suppression",
					}),
				}),
			);

			expect(res.status).toBe(201);
			const body = (await parseBody(res)) as {
				data: { address: string; channel: string; reason: string };
			};
			expect(body.data).toMatchObject({
				address: "typed-suppression@example.com",
				channel: "email",
				reason: "manual_suppression",
			});
		});
	});
});

// ---------------------------------------------------------------------------
// Subscriber endpoint typed context — subscriberId non-optional in ctx
// ---------------------------------------------------------------------------

describe("Subscriber endpoint typed context — subscriberId in ctx", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("GET /notifications — subscriberId from typed ctx", () => {
		it("should return inbox for the authenticated subscriber", async () => {
			// Create inbox items for two different subscribers
			const inboxData1 = {
				subscriberId: SUBSCRIBER_ID,
				workspaceId: "ws_1",
				eventType: "test.event",
				category: "transactional",
				body: "",
			};
			const inboxData2 = {
				subscriberId: "other_sub",
				workspaceId: "ws_1",
				eventType: "test.event",
				category: "transactional",
				body: "",
			};
			await ctx.inboxRepo.create(inboxData1);
			await ctx.inboxRepo.create(inboxData2);

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/notifications", {
					headers: subscriberAuthHeader(SUBSCRIBER_ID),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as {
				data: { items: Array<{ subscriberId: string }> };
			};
			// Only the authenticated subscriber's items
			expect(body.data.items).toHaveLength(1);
			expect(body.data.items[0]!.subscriberId).toBe(SUBSCRIBER_ID);
		});

		it("should apply limit coercion on GET /notifications?limit=N", async () => {
			// Create multiple inbox items
			for (let i = 0; i < 5; i++) {
				await ctx.inboxRepo.create({
					subscriberId: SUBSCRIBER_ID,
					workspaceId: "ws_1",
					eventType: "test.event",
					category: "transactional",
					body: "",
				});
			}

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/notifications?limit=2", {
					headers: subscriberAuthHeader(SUBSCRIBER_ID),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as { data: { items: unknown[] } };
			// If coercion worked, limit=2 constrains the result
			expect(body.data.items.length).toBeLessThanOrEqual(2);
		});
	});

	describe("GET /notifications/unread/count — subscriberId non-optional", () => {
		it("should return unread count for authenticated subscriber", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/notifications/unread/count", {
					headers: subscriberAuthHeader(SUBSCRIBER_ID),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as { data: { count: number } };
			expect(typeof body.data.count).toBe("number");
			expect(body.data.count).toBe(0);
		});
	});

	describe("PUT /preferences — typed ctx.body (preferenceBodySchema)", () => {
		it("should upsert preference using typed body fields", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/preferences", {
					method: "PUT",
					headers: jsonSubscriberHeader(SUBSCRIBER_ID),
					body: JSON.stringify({
						topicKey: "promotions",
						channel: "email",
						enabled: false,
					}),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as {
				data: { topicKey: string; channel: string; enabled: boolean };
			};
			expect(body.data).toMatchObject({
				topicKey: "promotions",
				channel: "email",
				enabled: false,
			});
		});
	});

	describe("POST /notifications/:id/snooze — snoozeBodySchema date coercion", () => {
		it("should snooze notification using typed ctx.body.until (Date coercion)", async () => {
			// Create inbox item owned by SUBSCRIBER_ID
			const item = await ctx.inboxRepo.create({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: "ws_1",
				eventType: "test.event",
				category: "transactional",
				body: "",
			});

			const untilDate = new Date("2030-01-01T00:00:00Z").toISOString();

			const res = await ctx.server.handler(
				new Request(`http://localhost/emito/v1/notifications/${item.id}/snooze`, {
					method: "POST",
					headers: jsonSubscriberHeader(SUBSCRIBER_ID),
					body: JSON.stringify({ until: untilDate }),
				}),
			);

			// If ctx.body.until is used directly (as Date after coercion by central parse),
			// this should succeed (snoozeBodySchema uses z.coerce.date())
			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as { data: { success: boolean } };
			expect(body.data.success).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// Workspace endpoint typed context — subscriberId + workspaceRole in ctx
// ---------------------------------------------------------------------------

describe("Workspace endpoint typed context — subscriberId + workspaceRole", () => {
	let ctx: ReturnType<typeof createTestServer>;
	let workspaceRole: "admin" | "member" | null;

	beforeEach(() => {
		workspaceRole = "admin";
		ctx = createTestServer(async () => workspaceRole);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("GET /workspace/:wsId/integrations — typed wsId param", () => {
		it("should return integrations for the specified workspace", async () => {
			workspaceRole = "admin";

			const res = await ctx.server.handler(
				new Request(`http://localhost/emito/v1/workspace/${WORKSPACE_ID}/integrations`, {
					headers: subscriberAuthHeader(SUBSCRIBER_ID),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as { data: { integrations: unknown[] } };
			expect(Array.isArray(body.data.integrations)).toBe(true);
		});
	});

	describe("GET /workspace/:wsId/members/preferences — workspaceRole admin check", () => {
		it("should return 403 when member (not admin) accesses member preferences", async () => {
			workspaceRole = "member";

			const res = await ctx.server.handler(
				new Request(`http://localhost/emito/v1/workspace/${WORKSPACE_ID}/members/preferences`, {
					headers: subscriberAuthHeader(SUBSCRIBER_ID),
				}),
			);

			expect(res.status).toBe(403);
		});

		it("should return preferences when workspace admin accesses member preferences", async () => {
			workspaceRole = "admin";

			const res = await ctx.server.handler(
				new Request(`http://localhost/emito/v1/workspace/${WORKSPACE_ID}/members/preferences`, {
					headers: subscriberAuthHeader(SUBSCRIBER_ID),
				}),
			);

			expect(res.status).toBe(200);
		});
	});

	describe("PUT /workspace/:wsId/defaults — typed ctx.body (setWorkspaceDefaultsBodySchema)", () => {
		it("should set workspace defaults using typed body", async () => {
			workspaceRole = "admin";

			const res = await ctx.server.handler(
				new Request(`http://localhost/emito/v1/workspace/${WORKSPACE_ID}/defaults`, {
					method: "PUT",
					headers: {
						...subscriberAuthHeader(SUBSCRIBER_ID),
						"content-type": "application/json",
					},
					body: JSON.stringify({
						topicKey: "newsletters",
						channel: "email",
						enabled: false,
						isMandatory: false,
					}),
				}),
			);

			expect(res.status).toBe(200);
			const body = (await parseBody(res)) as {
				data: { topicKey: string; enabled: boolean };
			};
			expect(body.data).toMatchObject({ topicKey: "newsletters", enabled: false });
		});
	});
});
