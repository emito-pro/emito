/**
 * Integration tests for {@link DrizzleNotificationRepository.listAdmin} against a real
 * PostgreSQL — the cross-workspace Activity Log query.
 *
 * Covers the subscriber join (email/phone enrichment), the multi-value filters
 * (status/channel/event/category/provider/errorType IN-sets), the exact
 * `workspaceId` filter, the exact `subscriberId` filter, the free-text `q` over
 * id/event/email/phone, the inclusive
 * date bounds, newest-first ordering, cursor pagination + `total`, and graceful
 * degradation when a notification's subscriber is absent.
 *
 * @module __tests__/repositories/notification-admin-list
 */
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { DrizzleNotificationRepository } from "../../src/repositories/drizzle-notification-repository";
import { emito_notifications } from "../../src/schema/notifications";
import { emito_subscribers } from "../../src/schema/subscribers";
import { dbAvailable, getDb, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

/** Insert a subscriber row, returning its id. */
async function seedSubscriber(
	id: string,
	fields: { email?: string | null; phone?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<string> {
	const [row] = await getDb()
		.insert(emito_subscribers)
		.values({
			id,
			email: fields.email ?? null,
			phone: fields.phone ?? null,
			metadata: fields.metadata ?? {},
		})
		.returning({ id: emito_subscribers.id });
	if (!row) throw new Error(`failed to seed subscriber ${id}`);
	return row.id;
}

/** Insert a notification row directly (so every column can be set), returning its id. */
async function seedNotification(values: {
	id: string;
	subscriberId: string;
	workspaceId?: string | null;
	eventType: string;
	category: string;
	channel: string;
	status: string;
	provider?: string | null;
	providerMsgId?: string | null;
	errorMessage?: string | null;
	errorClassification?: string | null;
	attempts?: number;
}): Promise<string> {
	const [row] = await getDb()
		.insert(emito_notifications)
		.values({
			id: values.id,
			subscriberId: values.subscriberId,
			workspaceId: values.workspaceId ?? null,
			eventType: values.eventType,
			category: values.category,
			channel: values.channel,
			status: values.status,
			provider: values.provider ?? null,
			providerMsgId: values.providerMsgId ?? null,
			errorMessage: values.errorMessage ?? null,
			errorClassification: values.errorClassification ?? null,
			attempts: values.attempts ?? 1,
		})
		.returning({ id: emito_notifications.id });
	if (!row) throw new Error(`failed to seed notification ${values.id}`);
	return row.id;
}

/**
 * Seed a small, deterministic cross-workspace dataset.
 *
 * Inserts one at a time with a `tick()` between rows so the DB-default `createdAt`
 * strictly increases (deterministic newest-first ordering for the assertions).
 */
async function seedDataset(): Promise<void> {
	await seedSubscriber("sub_alice", { email: "alice@example.com", phone: "+15550001111" });
	await seedSubscriber("sub_bob", { email: "bob@acme.test", phone: null });

	await seedNotification({
		id: "ntf_a",
		subscriberId: "sub_alice",
		workspaceId: "ws_one",
		eventType: "order.placed",
		category: "transactional",
		channel: "email",
		status: "delivered",
		provider: "resend",
		providerMsgId: "re_1",
	});
	await tick();
	await seedNotification({
		id: "ntf_b",
		subscriberId: "sub_bob",
		workspaceId: "ws_two",
		eventType: "promo.sale",
		category: "marketing",
		channel: "sms",
		status: "failed",
		provider: "twilio",
		errorMessage: "30003 Unreachable destination",
		errorClassification: "transient",
	});
	await tick();
	await seedNotification({
		id: "ntf_c",
		subscriberId: "sub_alice",
		workspaceId: "ws_one",
		eventType: "newsletter.weekly",
		category: "marketing",
		channel: "email",
		status: "bounced",
		provider: "resend",
		errorMessage: "550 5.1.1 User unknown",
		errorClassification: "permanent",
	});
}

describe("DrizzleNotificationRepository.listAdmin", () => {
	it("returns rows newest-first enriched with the joined subscriber email/phone", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedDataset();

		const page = await repo.listAdmin({ limit: 50 });
		expect(page.total).toBe(3);
		expect(page.hasMore).toBe(false);
		expect(page.cursor).toBeNull();
		// Newest-first: ntf_c, ntf_b, ntf_a.
		expect(page.items.map((r) => r.id)).toEqual(["ntf_c", "ntf_b", "ntf_a"]);

		const alice = page.items.find((r) => r.id === "ntf_a");
		expect(alice?.subscriberEmail).toBe("alice@example.com");
		expect(alice?.subscriberPhone).toBe("+15550001111");
		expect(alice?.provider).toBe("resend");
	});

	it("degrades a notification with no matching subscriber to null join fields", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedNotification({
			id: "ntf_orphan",
			subscriberId: "sub_missing",
			eventType: "order.placed",
			category: "transactional",
			channel: "email",
			status: "sent",
		});

		const page = await repo.listAdmin({ limit: 50 });
		expect(page.total).toBe(1);
		const row = page.items[0];
		expect(row?.id).toBe("ntf_orphan");
		expect(row?.subscriberEmail).toBeNull();
		expect(row?.subscriberPhone).toBeNull();
		expect(row?.subscriberMetadata).toEqual({});
	});

	it("filters by a multi-value status set", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedDataset();

		const page = await repo.listAdmin({ limit: 50, filters: { status: ["failed", "bounced"] } });
		expect(page.total).toBe(2);
		expect(page.items.map((r) => r.id).sort()).toEqual(["ntf_b", "ntf_c"]);
	});

	it("filters by channel, category, provider, and errorType sets", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedDataset();

		expect((await repo.listAdmin({ limit: 50, filters: { channel: ["sms"] } })).total).toBe(1);
		expect((await repo.listAdmin({ limit: 50, filters: { category: ["marketing"] } })).total).toBe(2);
		expect((await repo.listAdmin({ limit: 50, filters: { provider: ["twilio"] } })).total).toBe(1);
		expect(
			(await repo.listAdmin({ limit: 50, filters: { errorType: ["permanent"] } })).total,
		).toBe(1);
	});

	it("filters by an exact workspaceId", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedDataset();

		const page = await repo.listAdmin({ limit: 50, filters: { workspaceId: "ws_two" } });
		expect(page.total).toBe(1);
		expect(page.items[0]?.id).toBe("ntf_b");
	});

	it("filters by an exact subscriberId (scopes the log to one recipient)", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedDataset();

		const page = await repo.listAdmin({ limit: 50, filters: { subscriberId: "sub_alice" } });
		expect(page.total).toBe(2);
		expect(page.items.map((r) => r.id).sort()).toEqual(["ntf_a", "ntf_c"]);
		expect(page.items.every((r) => r.subscriberId === "sub_alice")).toBe(true);
	});

	it("free-text q matches notification id, event, and subscriber email/phone", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedDataset();

		// id substring
		expect((await repo.listAdmin({ limit: 50, filters: { q: "ntf_a" } })).total).toBe(1);
		// event slug substring
		expect((await repo.listAdmin({ limit: 50, filters: { q: "newsletter" } })).total).toBe(1);
		// subscriber email substring (alice has 2 notifications)
		expect((await repo.listAdmin({ limit: 50, filters: { q: "alice@" } })).total).toBe(2);
		// subscriber phone substring (bob's is null; alice's matches)
		expect((await repo.listAdmin({ limit: 50, filters: { q: "5550001111" } })).total).toBe(2);
		// case-insensitive
		expect((await repo.listAdmin({ limit: 50, filters: { q: "ALICE@" } })).total).toBe(2);
	});

	it("applies inclusive date bounds on createdAt", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedDataset();

		const all = await repo.listAdmin({ limit: 50 });
		const oldest = all.items[all.items.length - 1];
		const newest = all.items[0];
		expect(oldest && newest).toBeTruthy();
		if (oldest === undefined || newest === undefined) throw new Error("dataset not seeded");

		// A 1ms margin sidesteps the microsecond-vs-millisecond precision gap between
		// PG `timestamptz` and the round-tripped JS `Date` (the bound itself is inclusive).
		const MS = 1;

		// from just below the newest row's createdAt → only the newest row remains.
		const fromNewest = await repo.listAdmin({
			limit: 50,
			filters: { from: new Date(newest.createdAt.getTime() - MS) },
		});
		expect(fromNewest.total).toBe(1);
		expect(fromNewest.items[0]?.id).toBe(newest.id);

		// to just above the oldest row's createdAt → only the oldest row remains.
		const toOldest = await repo.listAdmin({
			limit: 50,
			filters: { to: new Date(oldest.createdAt.getTime() + MS) },
		});
		expect(toOldest.total).toBe(1);
		expect(toOldest.items[0]?.id).toBe(oldest.id);
	});

	it("paginates with a cursor and reports the full filtered total", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedDataset();

		const first = await repo.listAdmin({ limit: 2 });
		expect(first.total).toBe(3);
		expect(first.hasMore).toBe(true);
		expect(first.cursor).not.toBeNull();
		expect(first.items.map((r) => r.id)).toEqual(["ntf_c", "ntf_b"]);

		const second = await repo.listAdmin({ limit: 2, cursor: first.cursor });
		expect(second.total).toBe(3);
		expect(second.hasMore).toBe(false);
		expect(second.cursor).toBeNull();
		expect(second.items.map((r) => r.id)).toEqual(["ntf_a"]);
	});

	it("returns an empty page (total 0) when nothing matches", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await seedDataset();

		const page = await repo.listAdmin({ limit: 50, filters: { workspaceId: "ws_nope" } });
		expect(page).toEqual({ items: [], hasMore: false, cursor: null, total: 0 });
	});

	it("rejects a malformed cursor with CURSOR_INVALID", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleNotificationRepository(getDb());
		await expect(repo.listAdmin({ limit: 50, cursor: "!!!not-base64-date!!!" })).rejects.toMatchObject(
			{ code: EMITO_ERROR_CODE.CURSOR_INVALID },
		);
	});
});
