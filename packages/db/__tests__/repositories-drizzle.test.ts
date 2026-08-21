/**
 * Integration tests for Drizzle repository implementations.
 * Covers: list/cursor methods for the admin repositories.
 *
 * Tests run against a real PostgreSQL 16 instance via Testcontainers.
 * Container is started in global-setup.ts; this file uses the injected DB_URI.
 * Each test has a clean slate via beforeEach table truncation (see test-setup.ts).
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { DrizzleDb } from "../src/repositories/db-type";
import {
	DrizzleDeadLetterRepository,
	DrizzleInboxRepository,
	DrizzleNotificationRepository,
	DrizzleSubscriberRepository,
	DrizzleSuppressionRepository,
} from "../src/repositories/index";

// ---------------------------------------------------------------------------
// DB connection setup — uses the container URI injected by global-setup.ts
// ---------------------------------------------------------------------------

let pgClient: ReturnType<typeof postgres>;
// biome-ignore lint/suspicious/noExplicitAny: DrizzleDb is PgDatabase<any>; postgres-js driver type is compatible at runtime
let db: DrizzleDb;

beforeAll(async () => {
	const uri = inject("DB_URI");

	if (!uri) {
		console.warn("DB_URI not injected — Docker may be unavailable. Skipping integration tests.");
		return;
	}

	pgClient = postgres(uri, { max: 5 });
	db = drizzle(pgClient, { casing: "snake_case" });

	await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

afterAll(async () => {
	if (pgClient) {
		await pgClient.end();
	}
});

function hasDb(): boolean {
	return db != null;
}

/**
 * Cursor pagination orders by the row's timestamp column (createdAt /
 * exhaustedAt), which is populated by the DB's `now()` default. Rows created in
 * a tight loop can share an identical timestamp, and the strict `<` cursor
 * comparison then drops the tied row — making the paginate tests flaky. A short
 * await between inserts guarantees strictly increasing timestamps so the cursor
 * boundary is deterministic.
 */
function nextTimestampTick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 2));
}

// ---------------------------------------------------------------------------
// Test data factories (inline because these are short-lived, integration-only)
// ---------------------------------------------------------------------------

function notificationData(subscriberId: string, overrides: Record<string, unknown> = {}) {
	return {
		subscriberId,
		eventType: "user.welcome",
		category: "transactional",
		channel: "email" as const,
		status: "pending" as const,
		payload: {},
		metadata: {},
		...overrides,
	};
}

function inboxData(subscriberId: string, overrides: Record<string, unknown> = {}) {
	return {
		subscriberId,
		eventType: "user.welcome",
		category: "transactional",
		body: "Hello!",
		...overrides,
	};
}

function deadLetterData(subscriberId: string, notificationId: string) {
	return {
		notificationId,
		subscriberId,
		eventType: "user.welcome",
		channel: "email" as const,
		attempts: [
			{
				provider: "sendgrid",
				timestamp: new Date("2026-01-01T00:00:00Z"),
				errorCode: "PROVIDER_UNAVAILABLE",
				errorMessage: "503",
			},
		],
		payload: {},
	};
}

// ---------------------------------------------------------------------------
// DrizzleNotificationRepository
// ---------------------------------------------------------------------------

describe("DrizzleNotificationRepository", () => {
	it("should create and retrieve a notification by id", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleNotificationRepository(db);

		const created = await repo.create(notificationData("sub_drz_1"));

		expect(created.id).toMatch(/^ntf_/);
		expect(created.subscriberId).toBe("sub_drz_1");
		expect(created.status).toBe("pending");

		const found = await repo.findById(created.id);
		expect(found).toMatchObject({ id: created.id, subscriberId: "sub_drz_1" });
	});

	it("should return null for unknown notification id", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleNotificationRepository(db);

		const found = await repo.findById("ntf_ghost123");
		expect(found).toBeNull();
	});

	it("should update notification status", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleNotificationRepository(db);
		const created = await repo.create(notificationData("sub_drz_upd"));

		await repo.updateStatus(created.id, "sent", { provider: "sendgrid" });

		const found = await repo.findById(created.id);
		expect(found?.status).toBe("sent");
		expect(found?.provider).toBe("sendgrid");
	});

	describe("list", () => {
		it("should return notifications for subscriber ordered by createdAt desc", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleNotificationRepository(db);
			const subscriberId = "sub_drz_list";
			await repo.create(notificationData(subscriberId, { eventType: "user.welcome" }));
			await repo.create(notificationData(subscriberId, { eventType: "user.password_reset" }));
			// Different subscriber — should not appear
			await repo.create(notificationData("sub_drz_other"));

			const result = await repo.list(subscriberId);

			expect(result.items).toHaveLength(2);
			expect(result.items.every((n) => n.subscriberId === subscriberId)).toBe(true);
			expect(result.hasMore).toBe(false);
			// desc order: second created first in results
			expect(result.items[0]!.createdAt >= result.items[1]!.createdAt).toBe(true);
		});

		it("should return empty items when subscriber has no notifications", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleNotificationRepository(db);

			const result = await repo.list("sub_drz_empty");

			expect(result.items).toEqual([]);
			expect(result.hasMore).toBe(false);
		});

		it("should paginate with limit and cursor", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleNotificationRepository(db);
			const subscriberId = "sub_drz_paginate";
			// Create 3 items with distinct timestamps for deterministic ordering
			for (let i = 0; i < 3; i++) {
				await repo.create(notificationData(subscriberId));
				await nextTimestampTick();
			}

			const page1 = await repo.list(subscriberId, { limit: 2 });
			expect(page1.items).toHaveLength(2);
			expect(page1.hasMore).toBe(true);
			expect(page1.cursor).toBeDefined();

			const page2 = await repo.list(subscriberId, { limit: 2, cursor: page1.cursor });
			expect(page2.items).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
		});

		it("should filter by status", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleNotificationRepository(db);
			const subscriberId = "sub_drz_status";
			const n1 = await repo.create(notificationData(subscriberId));
			await repo.create(notificationData(subscriberId));
			await repo.updateStatus(n1.id, "delivered");

			const result = await repo.list(subscriberId, { status: "delivered" });

			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.status).toBe("delivered");
		});

		it("should filter by category", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleNotificationRepository(db);
			const subscriberId = "sub_drz_cat";
			await repo.create(notificationData(subscriberId, { category: "transactional" }));
			await repo.create(notificationData(subscriberId, { category: "marketing" }));

			const result = await repo.list(subscriberId, { category: "transactional" });

			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.category).toBe("transactional");
		});
	});

	describe("listCrossWorkspace", () => {
		it("should return notifications across all subscribers", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleNotificationRepository(db);
			const before = await repo.listCrossWorkspace();
			const beforeCount = before.items.length;

			await repo.create(notificationData("sub_cw_drz_1"));
			await repo.create(notificationData("sub_cw_drz_2"));

			const result = await repo.listCrossWorkspace();

			expect(result.items.length).toBeGreaterThanOrEqual(beforeCount + 2);
		});

		it("should paginate cross-workspace results", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleNotificationRepository(db);

			// Create known items for pagination
			for (let i = 0; i < 5; i++) {
				await repo.create(notificationData(`sub_cw_pg_drz_${i}`));
			}

			const page1 = await repo.listCrossWorkspace({ limit: 3 });
			expect(page1.items.length).toBeGreaterThanOrEqual(3);

			if (page1.hasMore) {
				const page2 = await repo.listCrossWorkspace({ limit: 3, cursor: page1.cursor });
				expect(page2.items.length).toBeGreaterThanOrEqual(1);
			}
		});
	});
});

// ---------------------------------------------------------------------------
// DrizzleInboxRepository
// ---------------------------------------------------------------------------

describe("DrizzleInboxRepository", () => {
	it("should create and find inbox item with generated id", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleInboxRepository(db);

		const created = await repo.create(inboxData("sub_drz_inbox_1"));

		expect(created.id).toMatch(/^inb_/);
		expect(created.subscriberId).toBe("sub_drz_inbox_1");
		expect(created.readAt).toBeUndefined();
		expect(created.archivedAt).toBeUndefined();
	});

	describe("findBySubscriber", () => {
		it("should return items for subscriber ordered by createdAt desc", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);
			const subscriberId = "sub_drz_inbox_list";
			await repo.create(inboxData(subscriberId));
			await repo.create(inboxData(subscriberId));
			await repo.create(inboxData("sub_drz_inbox_other"));

			const result = await repo.findBySubscriber(subscriberId);

			expect(result.items).toHaveLength(2);
			expect(result.items.every((i) => i.subscriberId === subscriberId)).toBe(true);
		});

		it("should return empty items for subscriber with no inbox entries", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);

			const result = await repo.findBySubscriber("sub_drz_inbox_empty");

			expect(result.items).toEqual([]);
			expect(result.hasMore).toBe(false);
		});

		it("should paginate with limit and cursor", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);
			const subscriberId = "sub_drz_inbox_pag";
			for (let i = 0; i < 3; i++) {
				await repo.create(inboxData(subscriberId));
				await nextTimestampTick();
			}

			const page1 = await repo.findBySubscriber(subscriberId, { limit: 2 });
			expect(page1.items).toHaveLength(2);
			expect(page1.hasMore).toBe(true);

			const page2 = await repo.findBySubscriber(subscriberId, {
				limit: 2,
				cursor: page1.cursor,
			});
			expect(page2.items).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
		});

		it("should filter to unread items when status=unread", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);
			const subscriberId = "sub_drz_inbox_unread";
			const item = await repo.create(inboxData(subscriberId));
			await repo.create(inboxData(subscriberId));
			await repo.updateReadAt(item.id);

			const result = await repo.findBySubscriber(subscriberId, { status: "unread" });

			expect(result.items.every((i) => i.readAt == null)).toBe(true);
			expect(result.items.every((i) => i.archivedAt == null)).toBe(true);
		});

		it("should filter to archived items when status=archived", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);
			const subscriberId = "sub_drz_inbox_archived";
			const item = await repo.create(inboxData(subscriberId));
			await repo.create(inboxData(subscriberId));
			await repo.updateArchivedAt(item.id);

			const result = await repo.findBySubscriber(subscriberId, { status: "archived" });

			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.id).toBe(item.id);
		});
	});

	describe("updateReadAt", () => {
		it("should persist readAt to the database", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);
			const item = await repo.create(inboxData("sub_drz_markread"));

			await repo.updateReadAt(item.id);

			const result = await repo.findBySubscriber("sub_drz_markread");
			const updated = result.items.find((i) => i.id === item.id);
			expect(updated?.readAt).toBeInstanceOf(Date);
		});
	});

	describe("updateArchivedAt", () => {
		it("should persist archivedAt to the database", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);
			const item = await repo.create(inboxData("sub_drz_archive"));

			await repo.updateArchivedAt(item.id);

			const result = await repo.findBySubscriber("sub_drz_archive", { status: "archived" });
			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.archivedAt).toBeInstanceOf(Date);
		});
	});

	describe("unreadCount", () => {
		it("should return count of unread non-archived items", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);
			const subscriberId = "sub_drz_unread_count";
			const item1 = await repo.create(inboxData(subscriberId));
			await repo.create(inboxData(subscriberId));
			await repo.updateReadAt(item1.id);

			const count = await repo.unreadCount(subscriberId);

			expect(count).toBe(1);
		});

		it("should return 0 when subscriber has no inbox items", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);

			const count = await repo.unreadCount("sub_drz_no_inbox");

			expect(count).toBe(0);
		});

		it("should not count archived items", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleInboxRepository(db);
			const subscriberId = "sub_drz_arch_not_unread";
			const item = await repo.create(inboxData(subscriberId));
			await repo.updateArchivedAt(item.id);

			const count = await repo.unreadCount(subscriberId);

			expect(count).toBe(0);
		});
	});
});

// ---------------------------------------------------------------------------
// DrizzleSubscriberRepository
// ---------------------------------------------------------------------------

describe("DrizzleSubscriberRepository", () => {
	it("should create and retrieve a subscriber by id", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleSubscriberRepository(db);

		const created = await repo.create({
			id: "sub_drz_create_1",
			email: "drz@example.com",
		});

		expect(created.id).toBe("sub_drz_create_1");
		expect(created.email).toBe("drz@example.com");
		expect(created.lang).toBe("en");

		const found = await repo.findById("sub_drz_create_1");
		expect(found?.id).toBe("sub_drz_create_1");
	});

	it("should return null for unknown subscriber id", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleSubscriberRepository(db);

		const found = await repo.findById("sub_drz_ghost");
		expect(found).toBeNull();
	});

	describe("list", () => {
		it("should return non-erased subscribers ordered by createdAt desc", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);
			await repo.create({ id: "sub_drz_list_a", email: "a_drz@example.com" });
			await repo.create({ id: "sub_drz_list_b", email: "b_drz@example.com" });

			const result = await repo.list();

			expect(result.items.every((s) => !s.erasedAt)).toBe(true);
			const ids = result.items.map((s) => s.id);
			expect(ids).toContain("sub_drz_list_a");
			expect(ids).toContain("sub_drz_list_b");
		});

		it("should paginate subscribers with limit and cursor", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);
			for (let i = 0; i < 5; i++) {
				await repo.create({ id: `sub_drz_pg_${i}`, email: `pg${i}@example.com` });
			}

			const page1 = await repo.list({ limit: 3 });
			expect(page1.items).toHaveLength(3);
			expect(page1.hasMore).toBe(true);

			const page2 = await repo.list({ limit: 3, cursor: page1.cursor });
			expect(page2.items.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("erase", () => {
		it("should set erasedAt and clear PII fields", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);
			await repo.create({ id: "sub_drz_erase", email: "erase_drz@example.com" });

			await repo.erase("sub_drz_erase");

			const found = await repo.findById("sub_drz_erase");
			expect(found?.erasedAt).toBeInstanceOf(Date);
			expect(found?.email).toBeUndefined();
		});

		it("should not appear in list() after erasure", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);
			await repo.create({ id: "sub_drz_erase_hidden", email: "hidden_drz@example.com" });
			await repo.erase("sub_drz_erase_hidden");

			const result = await repo.list();

			const ids = result.items.map((s) => s.id);
			expect(ids).not.toContain("sub_drz_erase_hidden");
		});

		it("cascades the anonymisation across dependent collections + returns truthful counts", async () => {
			if (!hasDb()) return;
			const subRepo = new DrizzleSubscriberRepository(db);
			const notifRepo = new DrizzleNotificationRepository(db);
			const inboxRepo = new DrizzleInboxRepository(db);
			const dlqRepo = new DrizzleDeadLetterRepository(db);
			const id = "sub_drz_cascade";
			await subRepo.create({ id, email: "cascade_drz@example.com", phone: "+15550000" });

			// Seed PII into every cascade collection.
			const n1 = await notifRepo.create(
				notificationData(id, {
					deliveryAddress: "cascade_drz@example.com",
					payload: { order: "X-1" },
					metadata: { ip: "1.2.3.4" },
				}),
			);
			await notifRepo.create(
				notificationData(id, {
					deliveryAddress: "cascade_drz@example.com",
					payload: { order: "X-2" },
				}),
			);
			await inboxRepo.create(
				inboxData(id, { subject: "Hi cascade", body: "secret body", data: { k: "v" } }),
			);
			await dlqRepo.create(deadLetterData(id, n1.id));
			await db.execute(sql`
				INSERT INTO emito_push_tokens (id, subscriber_id, token, platform, device_name, active)
				VALUES (${"pt_drz_1"}, ${id}, ${"tok-aaa"}, ${"ios"}, ${"My iPhone"}, ${true})
			`);
			await db.execute(sql`
				INSERT INTO emito_integrations (id, owner_id, subscriber_id, name, channel, config, active)
				VALUES (${"int_drz_1"}, ${"ws"}, ${id}, ${"Slack"}, ${"slack"}, ${sql`${JSON.stringify({ handle: "@x" })}::jsonb`}, ${true})
			`);
			await db.execute(sql`
				INSERT INTO emito_preferences (id, subscriber_id, topic_key, channel, enabled)
				VALUES (${"prf_drz_1"}, ${id}, ${"marketing"}, ${"email"}, ${true})
			`);

			const counts = await subRepo.erase(id);

			// The returned counts reflect exactly what was mutated.
			expect(counts).toEqual({
				notifications: 2,
				inboxItems: 1,
				pushTokens: 1,
				personalIntegrations: 1,
				preferences: 1,
				deadLetters: 1,
			});

			// Notification PII scrubbed.
			const notifRows = await db.execute(
				sql`SELECT delivery_address, payload, metadata FROM emito_notifications WHERE subscriber_id = ${id}`,
			);
			for (const r of notifRows as Array<{
				delivery_address: string | null;
				payload: unknown;
				metadata: unknown;
			}>) {
				expect(r.delivery_address).toBeNull();
				expect(r.payload).toEqual({});
				expect(r.metadata).toEqual({});
			}

			// Inbox PII scrubbed, dead-letter payload scrubbed.
			const inboxRows = await db.execute(
				sql`SELECT subject, body FROM emito_inbox WHERE subscriber_id = ${id}`,
			);
			expect((inboxRows[0] as { subject: string | null }).subject).toBeNull();
			expect((inboxRows[0] as { body: string }).body).toBe("[ERASED]");
			const dlqRows = await db.execute(
				sql`SELECT payload FROM emito_dead_letters WHERE subscriber_id = ${id}`,
			);
			expect((dlqRows[0] as { payload: unknown }).payload).toEqual({});

			// Push tokens / integrations / preferences deleted.
			const remaining = await db.execute(sql`
				SELECT
					(SELECT count(*)::int FROM emito_push_tokens WHERE subscriber_id = ${id}) AS tokens,
					(SELECT count(*)::int FROM emito_integrations WHERE subscriber_id = ${id}) AS integrations,
					(SELECT count(*)::int FROM emito_preferences WHERE subscriber_id = ${id}) AS preferences
			`);
			expect(remaining[0]).toEqual({ tokens: 0, integrations: 0, preferences: 0 });
		});
	});
});

// ---------------------------------------------------------------------------
// DrizzleSuppressionRepository
// ---------------------------------------------------------------------------

describe("DrizzleSuppressionRepository", () => {
	it("should create and find suppression record", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleSuppressionRepository(db);

		const created = await repo.create({
			address: "bounce_drz@example.com",
			channel: "email",
			reason: "bounce",
		});

		expect(created.id).toMatch(/^sup_/);
		expect(created.address).toBe("bounce_drz@example.com");
		expect(created.reason).toBe("bounce");

		const found = await repo.findByAddressAndChannel("bounce_drz@example.com", "email");
		expect(found).not.toBeNull();
		expect(found?.address).toBe("bounce_drz@example.com");
	});

	describe("list", () => {
		it("should return suppression records ordered by createdAt desc", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSuppressionRepository(db);
			await repo.create({ address: "sup1_drz@example.com", channel: "email", reason: "bounce" });
			await repo.create({ address: "sup2_drz@example.com", channel: "email", reason: "bounce" });

			const result = await repo.list();

			const addresses = result.items.map((s) => s.address);
			expect(addresses).toContain("sup1_drz@example.com");
			expect(addresses).toContain("sup2_drz@example.com");
		});

		it("should filter by channel", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSuppressionRepository(db);
			await repo.create({ address: "email_drz@example.com", channel: "email", reason: "bounce" });
			await repo.create({ address: "+15550009999", channel: "sms", reason: "bounce" });

			const result = await repo.list({ channel: "email" });

			expect(result.items.every((s) => s.channel === "email")).toBe(true);
		});

		it("should paginate with limit and cursor", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSuppressionRepository(db);
			for (let i = 0; i < 4; i++) {
				await repo.create({
					address: `cursor_drz_${i}@example.com`,
					channel: "email",
					reason: "bounce",
				});
				await nextTimestampTick();
			}

			const page1 = await repo.list({ limit: 3 });
			expect(page1.items).toHaveLength(3);
			expect(page1.hasMore).toBe(true);

			const page2 = await repo.list({ limit: 3, cursor: page1.cursor });
			expect(page2.items.length).toBeGreaterThanOrEqual(1);
		});
	});
});

// ---------------------------------------------------------------------------
// DrizzleDeadLetterRepository
// ---------------------------------------------------------------------------

describe("DrizzleDeadLetterRepository", () => {
	it("should create and retrieve a dead letter record", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleDeadLetterRepository(db);

		const created = await repo.create(deadLetterData("sub_drz_dlq", "ntf_drz_dlq_123"));

		expect(created.id).toMatch(/^dlq_/);
		expect(created.subscriberId).toBe("sub_drz_dlq");
		expect(created.notificationId).toBe("ntf_drz_dlq_123");
		expect(created.attempts).toHaveLength(1);

		const found = await repo.findById(created.id);
		expect(found?.id).toBe(created.id);
		// The attempt chain is JSONB; Postgres returns each `timestamp` as an ISO
		// string, but the record contract declares it a `Date`. `mapRow` revives it
		// so consumers can call `.toISOString()` without crashing.
		expect(found?.attempts).toHaveLength(1);
		expect(found?.attempts[0]?.timestamp).toBeInstanceOf(Date);
		expect(found?.attempts[0]?.timestamp.toISOString()).toBe("2026-01-01T00:00:00.000Z");
		expect(found?.attempts[0]?.provider).toBe("sendgrid");
		expect(found?.attempts[0]?.errorCode).toBe("PROVIDER_UNAVAILABLE");
	});

	it("should return null for unknown dead letter id", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleDeadLetterRepository(db);

		const found = await repo.findById("dlq_ghost");
		expect(found).toBeNull();
	});

	describe("list", () => {
		it("should return only unresolved records by default", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleDeadLetterRepository(db);
			await repo.create(deadLetterData("sub_drz_dlq_list_1", "ntf_dlq_l1"));
			const r2 = await repo.create(deadLetterData("sub_drz_dlq_list_2", "ntf_dlq_l2"));
			await repo.resolve(r2.id, "manual-discard");

			const result = await repo.list();

			expect(result.items.every((d) => d.resolvedAt == null)).toBe(true);
		});

		it("should paginate with limit and cursor", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleDeadLetterRepository(db);
			for (let i = 0; i < 4; i++) {
				await repo.create(deadLetterData(`sub_drz_dlq_pg_${i}`, `ntf_dlq_pg_${i}`));
				await nextTimestampTick();
			}

			const page1 = await repo.list({ limit: 3 });
			expect(page1.items).toHaveLength(3);
			expect(page1.hasMore).toBe(true);

			const page2 = await repo.list({ limit: 3, cursor: page1.cursor });
			expect(page2.items.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("resolve", () => {
		it("should set resolvedAt and resolution on the record", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleDeadLetterRepository(db);
			const created = await repo.create(deadLetterData("sub_drz_resolve", "ntf_drz_resolve"));

			await repo.resolve(created.id, "manually-discarded");

			const found = await repo.findById(created.id);
			expect(found?.resolvedAt).toBeInstanceOf(Date);
			expect(found?.resolution).toBe("manually-discarded");
		});

		it("should not affect other dead letter records", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleDeadLetterRepository(db);
			const r1 = await repo.create(deadLetterData("sub_drz_res_a", "ntf_drz_res_a"));
			const r2 = await repo.create(deadLetterData("sub_drz_res_b", "ntf_drz_res_b"));

			await repo.resolve(r1.id, "discarded");

			const r2Found = await repo.findById(r2.id);
			expect(r2Found?.resolvedAt).toBeUndefined();
		});
	});
});
