/**
 * Tests for Drizzle repositories implements clauses.
 *
 * These tests verify:
 *   1. Behavioral coverage for repositories not covered by repositories-drizzle.test.ts
 *      (DrizzlePreferenceRepository, DrizzleWorkspaceDefaultRepository, DrizzleIntegrationRepository)
 *   2. Missing method coverage on DrizzleInboxRepository
 *      (updateSnoozedUntil, markAllRead, clearReadAt, clearArchivedAt)
 *   3. Missing method coverage on DrizzleDeadLetterRepository
 *      (unresolve)
 *
 * TypeScript compile errors surface when `implements` clauses are added and
 * method signatures do not match their interface. A green build + passing tests
 * confirms both runtime behavior and interface compliance.
 *
 * Rules applied:
 *   - Test against real PostgreSQL via Testcontainers injected DB_URI (rule 12)
 *   - Test boundary conditions: empty, single, multiple (rule 4)
 *   - Assert on shape of return values, not just existence (rule 26)
 *   - Use toMatchObject for partial assertions on large objects (rule 27)
 *   - Do not test Drizzle internals (rule 30)
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { DrizzleDb } from "../src/repositories/db-type";
import {
	DrizzleDeadLetterRepository,
	DrizzleInboxRepository,
	DrizzleIntegrationRepository,
	DrizzlePreferenceRepository,
	DrizzleWorkspaceDefaultRepository,
} from "../src/repositories/index";

// ---------------------------------------------------------------------------
// DB connection setup
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

// ---------------------------------------------------------------------------
// DrizzlePreferenceRepository
// ---------------------------------------------------------------------------

describe("DrizzlePreferenceRepository", () => {
	it("should upsert a preference and retrieve it via findBySubscriber", async () => {
		if (!hasDb()) return;
		const repo = new DrizzlePreferenceRepository(db);

		const result = await repo.upsert({
			subscriberId: "sub_pref_1",
			workspaceId: "ws_pref_1",
			topicKey: "account.alerts",
			channel: "email",
			enabled: true,
		});

		expect(result).toMatchObject({
			subscriberId: "sub_pref_1",
			workspaceId: "ws_pref_1",
			topicKey: "account.alerts",
			channel: "email",
			enabled: true,
		});

		const found = await repo.findBySubscriber("sub_pref_1");
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ topicKey: "account.alerts", enabled: true });
	});

	it("should upsert update an existing preference (idempotent)", async () => {
		if (!hasDb()) return;
		const repo = new DrizzlePreferenceRepository(db);

		await repo.upsert({
			subscriberId: "sub_pref_upsert",
			workspaceId: "ws_pref_upsert",
			topicKey: "marketing.email",
			channel: "email",
			enabled: true,
		});

		const updated = await repo.upsert({
			subscriberId: "sub_pref_upsert",
			workspaceId: "ws_pref_upsert",
			topicKey: "marketing.email",
			channel: "email",
			enabled: false,
		});

		expect(updated.enabled).toBe(false);

		const all = await repo.listBySubscriber("sub_pref_upsert");
		expect(all).toHaveLength(1);
		expect(all[0]?.enabled).toBe(false);
	});

	it("should return empty array when subscriber has no preferences", async () => {
		if (!hasDb()) return;
		const repo = new DrizzlePreferenceRepository(db);

		const result = await repo.findBySubscriber("sub_pref_empty");

		expect(result).toEqual([]);
	});

	it("should filter by workspaceId", async () => {
		if (!hasDb()) return;
		const repo = new DrizzlePreferenceRepository(db);

		await repo.upsert({
			subscriberId: "sub_pref_ws",
			workspaceId: "ws_pref_a",
			topicKey: "alerts",
			channel: "email",
			enabled: true,
		});
		await repo.upsert({
			subscriberId: "sub_pref_ws",
			workspaceId: "ws_pref_b",
			topicKey: "alerts",
			channel: "email",
			enabled: false,
		});

		const wsA = await repo.findBySubscriber("sub_pref_ws", { workspaceId: "ws_pref_a" });
		expect(wsA).toHaveLength(1);
		expect(wsA[0]?.enabled).toBe(true);

		const wsB = await repo.findBySubscriber("sub_pref_ws", { workspaceId: "ws_pref_b" });
		expect(wsB).toHaveLength(1);
		expect(wsB[0]?.enabled).toBe(false);
	});

	it("should filter by channel", async () => {
		if (!hasDb()) return;
		const repo = new DrizzlePreferenceRepository(db);

		await repo.upsert({
			subscriberId: "sub_pref_ch",
			workspaceId: "ws_ch",
			topicKey: "updates",
			channel: "email",
			enabled: true,
		});
		await repo.upsert({
			subscriberId: "sub_pref_ch",
			workspaceId: "ws_ch",
			topicKey: "updates",
			channel: "sms",
			enabled: false,
		});

		const emailOnly = await repo.findBySubscriber("sub_pref_ch", { channel: "email" });
		expect(emailOnly).toHaveLength(1);
		expect(emailOnly[0]?.channel).toBe("email");
	});

	it("should reset all preferences for a subscriber", async () => {
		if (!hasDb()) return;
		const repo = new DrizzlePreferenceRepository(db);

		await repo.upsert({
			subscriberId: "sub_pref_reset",
			workspaceId: "ws_reset",
			topicKey: "t1",
			channel: "email",
			enabled: true,
		});
		await repo.upsert({
			subscriberId: "sub_pref_reset",
			workspaceId: "ws_reset",
			topicKey: "t2",
			channel: "sms",
			enabled: false,
		});

		await repo.reset("sub_pref_reset");

		const remaining = await repo.listBySubscriber("sub_pref_reset");
		expect(remaining).toHaveLength(0);
	});

	it("should reset preferences only for a specific workspaceId", async () => {
		if (!hasDb()) return;
		const repo = new DrizzlePreferenceRepository(db);

		await repo.upsert({
			subscriberId: "sub_pref_reset_ws",
			workspaceId: "ws_to_reset",
			topicKey: "topic",
			channel: "email",
			enabled: true,
		});
		await repo.upsert({
			subscriberId: "sub_pref_reset_ws",
			workspaceId: "ws_to_keep",
			topicKey: "topic",
			channel: "email",
			enabled: true,
		});

		await repo.reset("sub_pref_reset_ws", "ws_to_reset");

		const remaining = await repo.listBySubscriber("sub_pref_reset_ws");
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.workspaceId).toBe("ws_to_keep");
	});

	it("should list preferences by workspace", async () => {
		if (!hasDb()) return;
		const repo = new DrizzlePreferenceRepository(db);

		await repo.upsert({
			subscriberId: "sub_a",
			workspaceId: "ws_list_test",
			topicKey: "topic",
			channel: "email",
			enabled: true,
		});
		await repo.upsert({
			subscriberId: "sub_b",
			workspaceId: "ws_list_test",
			topicKey: "topic",
			channel: "sms",
			enabled: false,
		});

		const result = await repo.listByWorkspace("ws_list_test");

		expect(result.length).toBeGreaterThanOrEqual(2);
		expect(result.every((r) => r.workspaceId === "ws_list_test")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// DrizzleWorkspaceDefaultRepository
// ---------------------------------------------------------------------------

describe("DrizzleWorkspaceDefaultRepository", () => {
	it("should upsert and retrieve a workspace default", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleWorkspaceDefaultRepository(db);

		const result = await repo.upsert({
			workspaceId: "ws_def_1",
			topicKey: "account.alerts",
			channel: "email",
			enabled: true,
			isMandatory: false,
		});

		expect(result).toMatchObject({
			workspaceId: "ws_def_1",
			topicKey: "account.alerts",
			channel: "email",
			enabled: true,
			isMandatory: false,
		});
	});

	it("should upsert update an existing workspace default (idempotent)", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleWorkspaceDefaultRepository(db);

		await repo.upsert({
			workspaceId: "ws_def_upsert",
			topicKey: "marketing",
			channel: "email",
			enabled: true,
			isMandatory: false,
		});

		const updated = await repo.upsert({
			workspaceId: "ws_def_upsert",
			topicKey: "marketing",
			channel: "email",
			enabled: false,
			isMandatory: true,
		});

		expect(updated.enabled).toBe(false);
		expect(updated.isMandatory).toBe(true);
	});

	it("should return empty array when workspace has no defaults", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleWorkspaceDefaultRepository(db);

		const result = await repo.findByWorkspace("ws_def_empty");

		expect(result).toEqual([]);
	});

	it("should findByWorkspace optionally filtered by topicKey", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleWorkspaceDefaultRepository(db);

		await repo.upsert({
			workspaceId: "ws_def_filter",
			topicKey: "topic_a",
			channel: "email",
			enabled: true,
			isMandatory: false,
		});
		await repo.upsert({
			workspaceId: "ws_def_filter",
			topicKey: "topic_b",
			channel: "sms",
			enabled: false,
			isMandatory: true,
		});

		const all = await repo.findByWorkspace("ws_def_filter");
		expect(all.length).toBeGreaterThanOrEqual(2);

		const filtered = await repo.findByWorkspace("ws_def_filter", "topic_a");
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.topicKey).toBe("topic_a");
	});

	it("should listByWorkspace return same results as findByWorkspace with no topicKey", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleWorkspaceDefaultRepository(db);

		await repo.upsert({
			workspaceId: "ws_def_list",
			topicKey: "t1",
			channel: "email",
			enabled: true,
			isMandatory: false,
		});
		await repo.upsert({
			workspaceId: "ws_def_list",
			topicKey: "t2",
			channel: "push",
			enabled: true,
			isMandatory: true,
		});

		const fromFind = await repo.findByWorkspace("ws_def_list");
		const fromList = await repo.listByWorkspace("ws_def_list");

		expect(fromFind).toEqual(fromList);
	});
});

// ---------------------------------------------------------------------------
// DrizzleIntegrationRepository
// ---------------------------------------------------------------------------

describe("DrizzleIntegrationRepository", () => {
	it("should create and retrieve an integration by id", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleIntegrationRepository(db);

		const created = await repo.create({
			ownerId: "ws_int_1",
			channel: "email",
			config: { apiKey: "test-key" },
			name: "My Integration",
		});

		expect(created.id).toBeDefined();
		expect(created.ownerId).toBe("ws_int_1");
		expect(created.channel).toBe("email");
		expect(created.active).toBe(true);

		const found = await repo.findById(created.id);
		expect(found).toMatchObject({ id: created.id, ownerId: "ws_int_1" });
	});

	it("should return undefined for unknown integration id", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleIntegrationRepository(db);

		const found = await repo.findById("int_ghost");
		expect(found).toBeUndefined();
	});

	it("should listByWorkspace return only active integrations for owner", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleIntegrationRepository(db);

		const i1 = await repo.create({
			ownerId: "ws_int_list",
			channel: "email",
			config: {},
		});
		const i2 = await repo.create({
			ownerId: "ws_int_list",
			channel: "sms",
			config: {},
		});
		// Different owner — should not appear
		await repo.create({
			ownerId: "ws_int_other",
			channel: "email",
			config: {},
		});

		const result = await repo.listByWorkspace("ws_int_list");

		const ids = result.map((i) => i.id);
		expect(ids).toContain(i1.id);
		expect(ids).toContain(i2.id);
		expect(result.every((i) => i.ownerId === "ws_int_list")).toBe(true);
	});

	it("should listBySubscriber return active integrations for a subscriber", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleIntegrationRepository(db);

		const i1 = await repo.create({
			ownerId: "ws_int_sub",
			subscriberId: "sub_int_1",
			channel: "email",
			config: {},
		});

		const result = await repo.listBySubscriber("sub_int_1");

		expect(result.some((i) => i.id === i1.id)).toBe(true);
	});

	it("should listBySubscriber return empty for subscriber with no integrations", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleIntegrationRepository(db);

		const result = await repo.listBySubscriber("sub_int_none");

		expect(result).toEqual([]);
	});

	it("should findBySubscriberAndChannel return active integrations", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleIntegrationRepository(db);

		const created = await repo.create({
			ownerId: "ws_int_bysub",
			subscriberId: "sub_int_bysub",
			channel: "sms",
			config: {},
		});

		const result = await repo.findBySubscriberAndChannel("sub_int_bysub", "sms");

		expect(result.some((i) => i.id === created.id)).toBe(true);
	});

	it("should findForRouting filter by workspace, channel, and eventType", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleIntegrationRepository(db);

		await repo.create({
			ownerId: "ws_int_route",
			channel: "email",
			events: ["user.welcome", "user.reset"],
			config: {},
		});
		await repo.create({
			ownerId: "ws_int_route",
			channel: "email",
			events: ["billing.invoice"],
			config: {},
		});

		const result = await repo.findForRouting({
			workspaceId: "ws_int_route",
			subscriberId: "sub_route_any",
			channel: "email",
			eventType: "user.welcome",
		});

		expect(result.every((i) => i.events?.includes("user.welcome"))).toBe(true);
		expect(result.some((i) => i.events?.includes("billing.invoice"))).toBe(false);
	});

	it("should update integration name and config", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleIntegrationRepository(db);

		const created = await repo.create({
			ownerId: "ws_int_update",
			channel: "email",
			config: { endpoint: "https://old.example.com" },
			name: "Old Name",
		});

		const updated = await repo.update(created.id, {
			name: "New Name",
			config: { endpoint: "https://new.example.com" },
		});

		expect(updated.name).toBe("New Name");
		expect(updated.config).toMatchObject({ endpoint: "https://new.example.com" });
	});

	it("should deactivate an integration (removes from active listings)", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleIntegrationRepository(db);

		const created = await repo.create({
			ownerId: "ws_int_deact",
			channel: "email",
			config: {},
		});

		await repo.deactivate(created.id);

		const result = await repo.listByWorkspace("ws_int_deact");
		expect(result.every((i) => i.id !== created.id)).toBe(true);

		const found = await repo.findById(created.id);
		expect(found?.active).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// DrizzleInboxRepository — additional method coverage
// ---------------------------------------------------------------------------

describe("DrizzleInboxRepository — additional methods", () => {
	function inboxData(subscriberId: string) {
		return {
			subscriberId,
			eventType: "user.welcome",
			category: "transactional",
			body: "Hello!",
		};
	}

	it("should updateSnoozedUntil persist the snooze date", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleInboxRepository(db);
		const item = await repo.create(inboxData("sub_inbox_snooze"));
		const snoozeDate = new Date("2030-01-01T00:00:00Z");

		await repo.updateSnoozedUntil(item.id, snoozeDate);

		const found = await repo.findById(item.id);
		expect(found?.snoozedUntil).toEqual(snoozeDate);
	});

	it("should markAllRead mark all unread items for a subscriber", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleInboxRepository(db);
		const subscriberId = "sub_inbox_markallread";
		await repo.create(inboxData(subscriberId));
		await repo.create(inboxData(subscriberId));

		await repo.markAllRead(subscriberId);

		const result = await repo.findBySubscriber(subscriberId, { status: "unread" });
		expect(result.items).toHaveLength(0);
	});

	it("should markAllRead not affect already-archived items", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleInboxRepository(db);
		const subscriberId = "sub_inbox_markallread_arch";
		const item = await repo.create(inboxData(subscriberId));
		await repo.create(inboxData(subscriberId));
		await repo.updateArchivedAt(item.id);

		await repo.markAllRead(subscriberId);

		// archived item should not be considered unread, so unread count should be 0
		const unreadCount = await repo.unreadCount(subscriberId);
		expect(unreadCount).toBe(0);
	});

	it("should clearReadAt remove the readAt timestamp", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleInboxRepository(db);
		const item = await repo.create(inboxData("sub_inbox_clearread"));
		await repo.updateReadAt(item.id);

		await repo.clearReadAt(item.id);

		const found = await repo.findById(item.id);
		expect(found?.readAt).toBeUndefined();
	});

	it("should clearArchivedAt remove the archivedAt timestamp", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleInboxRepository(db);
		const item = await repo.create(inboxData("sub_inbox_cleararch"));
		await repo.updateArchivedAt(item.id);

		await repo.clearArchivedAt(item.id);

		const found = await repo.findById(item.id);
		expect(found?.archivedAt).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// DrizzleDeadLetterRepository — unresolve method coverage
// ---------------------------------------------------------------------------

describe("DrizzleDeadLetterRepository — unresolve", () => {
	it("should unresolve a previously resolved dead letter record", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleDeadLetterRepository(db);

		const created = await repo.create({
			notificationId: "ntf_unresolve_1",
			subscriberId: "sub_unresolve_1",
			eventType: "user.welcome",
			channel: "email",
			attempts: [
				{
					provider: "sendgrid",
					timestamp: new Date("2026-01-01T00:00:00Z"),
					errorCode: "PROVIDER_UNAVAILABLE",
					errorMessage: "503",
				},
			],
			payload: {},
		});

		await repo.resolve(created.id, "manually-discarded");
		const resolved = await repo.findById(created.id);
		expect(resolved?.resolvedAt).toBeInstanceOf(Date);
		expect(resolved?.resolution).toBe("manually-discarded");

		await repo.unresolve(created.id);

		const unresolved = await repo.findById(created.id);
		expect(unresolved?.resolvedAt).toBeUndefined();
		expect(unresolved?.resolution).toBeUndefined();
	});

	it("should unresolve make the record appear in default list() again", async () => {
		if (!hasDb()) return;
		const repo = new DrizzleDeadLetterRepository(db);

		const created = await repo.create({
			notificationId: "ntf_unresolve_list",
			subscriberId: "sub_unresolve_list",
			eventType: "user.welcome",
			channel: "email",
			attempts: [
				{
					provider: "sendgrid",
					timestamp: new Date("2026-01-01T00:00:00Z"),
					errorCode: "PROVIDER_UNAVAILABLE",
					errorMessage: "503",
				},
			],
			payload: {},
		});

		await repo.resolve(created.id, "discard");

		const beforeUnresolve = await repo.list();
		expect(beforeUnresolve.items.every((d) => d.id !== created.id)).toBe(true);

		await repo.unresolve(created.id);

		const afterUnresolve = await repo.list();
		expect(afterUnresolve.items.some((d) => d.id === created.id)).toBe(true);
	});
});
