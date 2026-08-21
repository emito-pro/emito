/**
 * HTTP integration tests for admin list and subscriber list endpoints.
 */

import {
	InMemoryConsentRepository,
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryListMemberRepository,
	InMemoryListRepository,
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
const UNSUBSCRIBE_SECRET = "test-unsubscribe-secret-32-bytes!!";
const SUBSCRIBER_ID = "sub_test_001";

function adminHeaders(): Record<string, string> {
	return { "x-emito-admin-key": API_KEY };
}

function jsonAdminHeaders(): Record<string, string> {
	return { ...adminHeaders(), "content-type": "application/json" };
}

function subscriberHeaders(): Record<string, string> {
	return { authorization: `Bearer token-${SUBSCRIBER_ID}` };
}

function jsonSubscriberHeaders(): Record<string, string> {
	return { ...subscriberHeaders(), "content-type": "application/json" };
}

async function parseJson(response: Response): Promise<unknown> {
	return JSON.parse(await response.text());
}

function createMockEmito(): Emito {
	return {
		send: vi.fn().mockResolvedValue({ notificationId: "ntf_001", channels: [] }),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		healthCheck: vi.fn().mockResolvedValue({ healthy: true, providers: [], redis: null }),
		on: vi.fn(),
		off: vi.fn(),
		getEventNames: vi.fn().mockReturnValue([]),
		getEvent: vi.fn(),
	};
}

function createTestServer(
	overrides: {
		withListRepos?: boolean;
	} = {},
) {
	const listRepo = new InMemoryListRepository();
	const listMemberRepo = new InMemoryListMemberRepository();
	const emito = createMockEmito();

	const server = createEmitoServer({
		emito,
		apiKey: API_KEY,
		resolveSubscriberId: async (req) => {
			const auth = req.headers.get("authorization");
			if (auth?.startsWith(`Bearer token-${SUBSCRIBER_ID}`)) return SUBSCRIBER_ID;
			return null;
		},
		unsubscribeSecret: UNSUBSCRIBE_SECRET,
		repositories: {
			subscriberRepository: new InMemorySubscriberRepository(),
			notificationRepository: new InMemoryNotificationRepository(),
			deadLetterRepository: new InMemoryDeadLetterRepository(),
			suppressionRepository: new InMemorySuppressionRepository(),
			integrationRepository: new InMemoryIntegrationRepository(),
			workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
			inboxRepository: new InMemoryInboxRepository(),
			preferenceRepository: new InMemoryPreferenceRepository(),
			consentRepository: new InMemoryConsentRepository(),
			...(overrides.withListRepos !== false
				? { listRepository: listRepo, listMemberRepository: listMemberRepo }
				: {}),
		},
	});

	return { server, listRepo, listMemberRepo, emito };
}

// ---------------------------------------------------------------------------
// Admin List Endpoints (criteria 1, 9)
// ---------------------------------------------------------------------------

describe("Admin List Endpoints", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer({ withListRepos: true });
	});

	describe("POST /admin/lists — create list (criteria 1)", () => {
		it("should create a list and return 201", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/lists", {
					method: "POST",
					headers: jsonAdminHeaders(),
					body: JSON.stringify({ name: "Newsletter", slug: "newsletter", optinType: "double" }),
				}),
			);
			expect(res.status).toBe(201);
			const body = (await parseJson(res)) as { data: { slug: string; optinType: string } };
			expect(body.data.slug).toBe("newsletter");
			expect(body.data.optinType).toBe("double");
		});

		it("should return 400 for invalid slug format", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/lists", {
					method: "POST",
					headers: jsonAdminHeaders(),
					body: JSON.stringify({ name: "Bad Slug", slug: "Bad Slug!" }),
				}),
			);
			expect(res.status).toBe(400);
		});

		it("should require admin auth — return 401 without key", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/lists", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "Newsletter", slug: "newsletter" }),
				}),
			);
			expect(res.status).toBe(401);
		});
	});

	describe("GET /admin/lists — list all (criteria 9)", () => {
		it("should return empty list initially", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/lists", {
					headers: adminHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[]; hasMore: boolean } };
			expect(body.data.items).toEqual([]);
			expect(body.data.hasMore).toBe(false);
		});

		it("should return created lists with cursor pagination", async () => {
			for (let i = 0; i < 3; i++) {
				await ctx.listRepo.create({ name: `List ${i}`, slug: `list-${i}` });
			}

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/lists?limit=2", {
					headers: adminHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as {
				data: { items: unknown[]; hasMore: boolean; cursor: string };
			};
			expect(body.data.items).toHaveLength(2);
			expect(body.data.hasMore).toBe(true);
			expect(body.data.cursor).toBeDefined();
		});

		it("should filter by archived=true", async () => {
			const list = await ctx.listRepo.create({ name: "Archived", slug: "archived" });
			await ctx.listRepo.create({ name: "Active", slug: "active" });
			await ctx.listRepo.archive(list.id);

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/lists?archived=true", {
					headers: adminHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: { slug: string }[] } };
			expect(body.data.items).toHaveLength(1);
			expect(body.data.items[0]!.slug).toBe("archived");
		});

		it("should filter by archived=false to return only active lists", async () => {
			const list = await ctx.listRepo.create({ name: "Archived", slug: "archived" });
			await ctx.listRepo.create({ name: "Active", slug: "active" });
			await ctx.listRepo.archive(list.id);

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/admin/lists?archived=false", {
					headers: adminHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: { slug: string }[] } };
			expect(body.data.items).toHaveLength(1);
			expect(body.data.items[0]!.slug).toBe("active");
		});
	});

	describe("PUT /admin/lists/:id — update list (criteria 1)", () => {
		it("should update name and description", async () => {
			const list = await ctx.listRepo.create({ name: "Old", slug: "old" });
			const res = await ctx.server.handler(
				new Request(`http://localhost/emito/v1/admin/lists/${list.id}`, {
					method: "PUT",
					headers: jsonAdminHeaders(),
					body: JSON.stringify({ name: "New Name", description: "Updated description" }),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { name: string; description: string } };
			expect(body.data.name).toBe("New Name");
			expect(body.data.description).toBe("Updated description");
		});

		it("should return 400 for empty name", async () => {
			const list = await ctx.listRepo.create({ name: "Test", slug: "test" });
			const res = await ctx.server.handler(
				new Request(`http://localhost/emito/v1/admin/lists/${list.id}`, {
					method: "PUT",
					headers: jsonAdminHeaders(),
					body: JSON.stringify({ name: "" }),
				}),
			);
			expect(res.status).toBe(400);
		});
	});

	describe("POST /admin/lists/:id/archive — archive list (criteria 1)", () => {
		it("should set archivedAt on the list", async () => {
			const list = await ctx.listRepo.create({ name: "Test", slug: "test" });
			const res = await ctx.server.handler(
				new Request(`http://localhost/emito/v1/admin/lists/${list.id}/archive`, {
					method: "POST",
					headers: adminHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { archivedAt: string | null } };
			expect(body.data.archivedAt).not.toBeNull();
		});

		it("should make slug unfindable after archive (criteria 2)", async () => {
			const list = await ctx.listRepo.create({ name: "Test", slug: "test-slug" });
			await ctx.server.handler(
				new Request(`http://localhost/emito/v1/admin/lists/${list.id}/archive`, {
					method: "POST",
					headers: adminHeaders(),
				}),
			);
			const found = await ctx.listRepo.findBySlug("test-slug");
			expect(found).toBeNull();
		});
	});

	describe("list endpoints not registered without listRepository", () => {
		it("should return 404 for GET /admin/lists when listRepository is not configured (criteria 11)", async () => {
			const { server } = createTestServer({ withListRepos: false });
			const res = await server.handler(
				new Request("http://localhost/emito/v1/admin/lists", {
					headers: adminHeaders(),
				}),
			);
			expect(res.status).toBe(404);
		});
	});
});

// ---------------------------------------------------------------------------
// Subscriber List Endpoints (criteria 3, 4, 6, 7, 10)
// ---------------------------------------------------------------------------

describe("Subscriber List Endpoints", () => {
	let ctx: ReturnType<typeof createTestServer>;

	beforeEach(() => {
		ctx = createTestServer({ withListRepos: true });
	});

	describe("POST /lists/:slug/subscribe", () => {
		it("should return 200 on subscribe to single-opt-in list (criteria 3)", async () => {
			await ctx.listRepo.create({ name: "Newsletter", slug: "newsletter", optinType: "single" });

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { status: string } };
			expect(body.data.status).toBe("confirmed");
		});

		it("should return 200 on subscribe to double-opt-in list with unconfirmed status (criteria 4)", async () => {
			await ctx.listRepo.create({ name: "Newsletter", slug: "newsletter", optinType: "double" });

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { status: string } };
			expect(body.data.status).toBe("unconfirmed");
		});

		it("should trigger confirmation email send on double opt-in subscribe (criteria 4)", async () => {
			await ctx.listRepo.create({ name: "Newsletter", slug: "newsletter", optinType: "double" });

			await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);

			expect(ctx.emito.send).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "list.confirm",
					subscriberId: SUBSCRIBER_ID,
				}),
			);
		});

		it("should be idempotent on duplicate subscribe (criteria 6)", async () => {
			await ctx.listRepo.create({ name: "Newsletter", slug: "newsletter", optinType: "single" });

			const res1 = await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);
			const res2 = await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);

			expect(res1.status).toBe(200);
			expect(res2.status).toBe(200);

			// Only one membership row
			const memberships = await ctx.listMemberRepo.listBySubscriber(SUBSCRIBER_ID);
			expect(memberships.items).toHaveLength(1);
		});

		it("should return 401 without subscriber auth", async () => {
			await ctx.listRepo.create({ name: "Newsletter", slug: "newsletter" });

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/subscribe", {
					method: "POST",
				}),
			);
			expect(res.status).toBe(401);
		});

		it("should return error for non-existent list slug", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/ghost-list/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);
			expect(res.status).toBeGreaterThanOrEqual(400);
		});
	});

	describe("POST /lists/:slug/unsubscribe (criteria 7)", () => {
		it("should set membership to unsubscribed", async () => {
			await ctx.listRepo.create({ name: "Newsletter", slug: "newsletter", optinType: "single" });
			// Subscribe first
			await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/unsubscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { status: string } };
			expect(body.data.status).toBe("unsubscribed");
		});
	});

	describe("GET /subscriptions — list own subscriptions (criteria 10)", () => {
		it("should return subscriber's own list memberships", async () => {
			await ctx.listRepo.create({ name: "Newsletter", slug: "newsletter", optinType: "single" });
			await ctx.listRepo.create({
				name: "Announcements",
				slug: "announcements",
				optinType: "single",
			});

			await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);
			await ctx.server.handler(
				new Request("http://localhost/emito/v1/lists/announcements/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);

			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/subscriptions", {
					headers: subscriberHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as {
				data: { items: { subscriberId: string }[]; hasMore: boolean };
			};
			expect(body.data.items).toHaveLength(2);
			expect(body.data.items.every((m) => m.subscriberId === SUBSCRIBER_ID)).toBe(true);
		});

		it("should return empty list when subscriber has no subscriptions", async () => {
			const res = await ctx.server.handler(
				new Request("http://localhost/emito/v1/subscriptions", {
					headers: subscriberHeaders(),
				}),
			);
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: { items: unknown[] } };
			expect(body.data.items).toEqual([]);
		});

		it("should return 401 without subscriber auth", async () => {
			const res = await ctx.server.handler(new Request("http://localhost/emito/v1/subscriptions"));
			expect(res.status).toBe(401);
		});
	});

	describe("subscriber endpoints not registered without listRepository", () => {
		it("should return 404 for POST /lists/:slug/subscribe when listRepository is not configured", async () => {
			const { server } = createTestServer({ withListRepos: false });
			const res = await server.handler(
				new Request("http://localhost/emito/v1/lists/newsletter/subscribe", {
					method: "POST",
					headers: subscriberHeaders(),
				}),
			);
			expect(res.status).toBe(404);
		});
	});
});

// ---------------------------------------------------------------------------
// Stubs removed — criteria 11
// ---------------------------------------------------------------------------

describe("Stub endpoints replaced (criteria 11)", () => {
	it("should NOT have GET /subscriptions as a stub", async () => {
		const { server } = createTestServer({ withListRepos: false });
		const res = await server.handler(
			new Request("http://localhost/emito/v1/subscriptions", {
				headers: subscriberHeaders(),
			}),
		);
		// 401 (auth, real route registered) or 404 (route not found) but NOT 501 (stub)
		expect(res.status).not.toBe(501);
	});

	it("should NOT have POST /admin/lists as a stub", async () => {
		const { server } = createTestServer({ withListRepos: true });
		const res = await server.handler(
			new Request("http://localhost/emito/v1/admin/lists", {
				method: "POST",
				headers: jsonAdminHeaders(),
				body: JSON.stringify({ name: "Test", slug: "test" }),
			}),
		);
		expect(res.status).not.toBe(501);
	});

	it("should no longer have POST /admin/broadcast as a stub", async () => {
		const { server } = createTestServer();
		const res = await server.handler(
			new Request("http://localhost/emito/v1/admin/broadcast", {
				method: "POST",
				headers: jsonAdminHeaders(),
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).not.toBe(501);
	});
});
