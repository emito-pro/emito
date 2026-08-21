/**
 * Integration tests for {@link DrizzleBroadcastRepository} against a real PostgreSQL.
 * Covers create defaults (FK to emito_lists), atomic clamped counter increments, cancel, filters.
 */
import type { AdminBroadcastCreate } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { DrizzleBroadcastRepository } from "../../src/repositories/drizzle-broadcast-repository";
import { dbAvailable, getDb, seedList, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

async function input(
	overrides: Partial<AdminBroadcastCreate> = {},
	slug = `list-${Math.random().toString(36).slice(2, 8)}`,
): Promise<AdminBroadcastCreate> {
	const listId = overrides.listId ?? (await seedList(slug));
	return {
		title: "Spring sale",
		listId,
		eventKey: "promo.spring",
		createdByUserId: "user_1",
		...overrides,
	};
}

describe("DrizzleBroadcastRepository", () => {
	it("create starts scheduled with zeroed counters", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleBroadcastRepository(getDb());
		const record = await repo.create(await input());
		expect(record.id).toMatch(/^brc_/);
		expect(record.status).toBe("scheduled");
		expect(record.sentCount).toBe(0);
		expect(record.deliveredCount).toBe(0);
	});

	it("create persists an explicit startedAt for an immediate (running) send", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleBroadcastRepository(getDb());
		const startedAt = new Date("2026-06-06T12:00:00.000Z");
		const record = await repo.create(
			await input({ status: "running", startedAt, totalRecipients: 7 }),
		);
		expect(record.status).toBe("running");
		expect(record.totalRecipients).toBe(7);
		expect(record.startedAt?.toISOString()).toBe(startedAt.toISOString());

		// Round-trips through findById (the read path the detail/list endpoints use).
		const fetched = await repo.findById(record.id);
		expect(fetched?.startedAt?.toISOString()).toBe(startedAt.toISOString());
	});

	it("create leaves startedAt null when omitted (a future-scheduled send)", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleBroadcastRepository(getDb());
		const record = await repo.create(await input());
		expect(record.startedAt).toBeNull();
	});

	it("incrementCounters applies signed deltas atomically and clamps at zero", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleBroadcastRepository(getDb());
		const created = await repo.create(await input());

		await repo.incrementCounters(created.id, { sentCount: 5, deliveredCount: 3 });
		let fetched = await repo.findById(created.id);
		expect(fetched?.sentCount).toBe(5);
		expect(fetched?.deliveredCount).toBe(3);

		await repo.incrementCounters(created.id, { sentCount: -100 });
		fetched = await repo.findById(created.id);
		expect(fetched?.sentCount).toBe(0);
	});

	it("incrementCounters with an empty delta map verifies existence and no-ops", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleBroadcastRepository(getDb());
		const created = await repo.create(await input());
		await expect(repo.incrementCounters(created.id, {})).resolves.toBeUndefined();
		await expect(repo.incrementCounters("brc_x", {})).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("incrementCounters on unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleBroadcastRepository(getDb());
		await expect(repo.incrementCounters("brc_x", { sentCount: 1 })).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("cancel transitions non-terminal -> cancelled; terminal cancel conflicts", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleBroadcastRepository(getDb());
		const created = await repo.create(await input({ status: "sent" }));
		await expect(repo.cancel(created.id, "user_2")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});

		const scheduled = await repo.create(await input());
		const cancelled = await repo.cancel(scheduled.id, "user_2");
		expect(cancelled.status).toBe("cancelled");
	});

	it("cancel on unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleBroadcastRepository(getDb());
		await expect(repo.cancel("brc_x", "user_2")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("list filters by listId and status[], paginates newest-first", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleBroadcastRepository(getDb());
		const listA = await seedList("brc-list-a");
		await repo.create(await input({ listId: listA, status: "scheduled" }));
		await tick();
		await repo.create(await input({ status: "sent" }));

		expect((await repo.list({ limit: 50, filters: { listId: listA } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { status: ["sent"] } })).total).toBe(1);

		const first = await repo.list({ limit: 1 });
		expect(first.hasMore).toBe(true);
		expect(first.total).toBe(2);
	});
});
