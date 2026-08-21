/**
 * Round-trip + FK + index tests for `emito_broadcasts`.
 *
 * Verifies: prefixed-id generation (`brc_`), all funnel counters default to 0,
 * `status` defaults to `scheduled`, the FK to `emito_lists` rejects orphans, and
 * that the `(list_id, created_at DESC)` index serves per-list history lookups.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emito_broadcasts } from "../../src/schema/broadcasts";
import { type TestDb, closeDb, explain, firstRow, getDb, hasDb, insertList } from "./_helpers";

let db: TestDb | undefined;

beforeAll(async () => {
	db = await getDb();
}, 60_000);

afterAll(async () => {
	await closeDb();
});

function broadcast(listId: string, overrides: Record<string, unknown> = {}) {
	return {
		title: `Spring sale ${Date.now()}`,
		listId,
		eventKey: "marketing.spring_sale",
		payload: { subject: "50% off" },
		createdByUserId: `user_brc_${Date.now()}`,
		...overrides,
	};
}

describe("emito_broadcasts", () => {
	it("generates a brc_ prefixed id, defaults status to scheduled, and zeroes all counters", async () => {
		if (!hasDb(db)) return;
		const listId = await insertList(db);

		const inserted = firstRow(
			await db.insert(emito_broadcasts).values(broadcast(listId)).returning(),
		);

		expect(inserted.id).toMatch(/^brc_/);
		expect(inserted.status).toBe("scheduled");
		expect(inserted.totalRecipients).toBe(0);
		expect(inserted.sentCount).toBe(0);
		expect(inserted.deliveredCount).toBe(0);
		expect(inserted.failedCount).toBe(0);
		expect(inserted.bouncedCount).toBe(0);
		expect(inserted.openedCount).toBe(0);
		expect(inserted.clickedCount).toBe(0);
		expect(inserted.unsubscribedCount).toBe(0);
		expect(inserted.scheduledFor).toBeNull();
		expect(inserted.startedAt).toBeNull();
		expect(inserted.completedAt).toBeNull();
	});

	it("round-trips payload and incrementally updated counters", async () => {
		if (!hasDb(db)) return;
		const listId = await insertList(db);
		const payload = { subject: "Big news", body: "..." };

		const inserted = firstRow(
			await db.insert(emito_broadcasts).values(broadcast(listId, { payload })).returning(),
		);

		const updated = firstRow(
			await db
				.update(emito_broadcasts)
				.set({
					status: "sent",
					totalRecipients: 1000,
					sentCount: 1000,
					deliveredCount: 980,
					bouncedCount: 12,
				})
				.where(eq(emito_broadcasts.id, inserted.id))
				.returning(),
		);

		expect(updated.payload).toEqual(payload);
		expect(updated.deliveredCount).toBe(980);
		expect(updated.bouncedCount).toBe(12);
	});

	it("rejects a broadcast referencing a non-existent list (FK enforced)", async () => {
		if (!hasDb(db)) return;
		await expect(
			db.insert(emito_broadcasts).values(broadcast("lst_does_not_exist")),
		).rejects.toThrow();
	});

	it("uses the (list_id, created_at DESC) index for per-list history", async () => {
		if (!hasDb(db)) return;
		const listId = await insertList(db);
		await db.insert(emito_broadcasts).values(broadcast(listId));

		const plan = await explain(
			db,
			`SELECT * FROM emito_broadcasts WHERE list_id = '${listId}' ORDER BY created_at DESC`,
		);
		expect(plan).toContain("idx_emito_brc_list");
	});

	it("has the list_id FK to emito_lists", async () => {
		if (!hasDb(db)) return;
		const rows = await db.execute<{ foreign_table_name: string }>(sql`
			SELECT ccu.table_name AS foreign_table_name
			FROM information_schema.table_constraints AS tc
			JOIN information_schema.key_column_usage AS kcu
				ON tc.constraint_name = kcu.constraint_name
			JOIN information_schema.constraint_column_usage AS ccu
				ON ccu.constraint_name = tc.constraint_name
			WHERE tc.constraint_type = 'FOREIGN KEY'
				AND tc.table_name = 'emito_broadcasts'
				AND kcu.column_name = 'list_id'
		`);
		expect((rows[0] as { foreign_table_name: string }).foreign_table_name).toBe("emito_lists");
	});
});
