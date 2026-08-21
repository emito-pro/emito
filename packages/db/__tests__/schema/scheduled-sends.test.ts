/**
 * Round-trip + index tests for `emito_scheduled_sends`.
 *
 * Verifies: prefixed-id generation (`sch_`), `status` defaults to `pending`,
 * payload/recipients JSONB round-trip, nullable cancellation fields, and that the
 * partial `(scheduled_for) WHERE status='pending'` index serves the scheduler's
 * due-job poll.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emito_scheduled_sends } from "../../src/schema/scheduled-sends";
import { type TestDb, closeDb, explain, firstRow, getDb, hasDb } from "./_helpers";

let db: TestDb | undefined;

beforeAll(async () => {
	db = await getDb();
}, 60_000);

afterAll(async () => {
	await closeDb();
});

function scheduledSend(overrides: Record<string, unknown> = {}) {
	return {
		kind: "event",
		eventKey: "order.shipped",
		payload: { orderId: "ord_123" },
		recipients: { subscriberId: "user_42" },
		scheduledFor: new Date(Date.now() + 3_600_000),
		timezone: "America/New_York",
		createdByUserId: `user_sch_${Date.now()}`,
		...overrides,
	};
}

describe("emito_scheduled_sends", () => {
	it("generates a sch_ prefixed id, defaults status to pending, and round-trips JSONB", async () => {
		if (!hasDb(db)) return;
		const payload = { template: "shipped", vars: { tracking: "1Z999" } };
		const recipients = { listSlug: "vip" };

		const inserted = firstRow(
			await db
				.insert(emito_scheduled_sends)
				.values(scheduledSend({ payload, recipients }))
				.returning(),
		);

		expect(inserted.id).toMatch(/^sch_/);
		expect(inserted.status).toBe("pending");
		expect(inserted.cancelledAt).toBeNull();
		expect(inserted.cancelledByUserId).toBeNull();

		const found = firstRow(
			await db
				.select()
				.from(emito_scheduled_sends)
				.where(eq(emito_scheduled_sends.id, inserted.id)),
		);
		expect(found.payload).toEqual(payload);
		expect(found.recipients).toEqual(recipients);
		expect(found.timezone).toBe("America/New_York");
	});

	it("records cancellation metadata when a job is cancelled", async () => {
		if (!hasDb(db)) return;
		const inserted = firstRow(
			await db.insert(emito_scheduled_sends).values(scheduledSend()).returning(),
		);
		const cancelledBy = `user_cancel_${Date.now()}`;

		const updated = firstRow(
			await db
				.update(emito_scheduled_sends)
				.set({ status: "cancelled", cancelledAt: new Date(), cancelledByUserId: cancelledBy })
				.where(eq(emito_scheduled_sends.id, inserted.id))
				.returning(),
		);

		expect(updated.status).toBe("cancelled");
		expect(updated.cancelledByUserId).toBe(cancelledBy);
		expect(updated.cancelledAt).toBeInstanceOf(Date);
	});

	it("uses the partial pending-due index for the scheduler poll", async () => {
		if (!hasDb(db)) return;
		await db.insert(emito_scheduled_sends).values(scheduledSend());

		const plan = await explain(
			db,
			"SELECT * FROM emito_scheduled_sends WHERE status = 'pending' AND scheduled_for <= now() ORDER BY scheduled_for ASC",
		);
		expect(plan).toContain("idx_emito_sch_pending_due");
	});

	it("declares the pending-due index as partial (WHERE status='pending')", async () => {
		if (!hasDb(db)) return;
		const rows = await db.execute<{ indexdef: string }>(
			sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_emito_sch_pending_due'`,
		);
		const def = (rows[0] as { indexdef: string } | undefined)?.indexdef ?? "";
		expect(def.toLowerCase()).toContain("where");
		expect(def).toContain("'pending'");
	});
});
