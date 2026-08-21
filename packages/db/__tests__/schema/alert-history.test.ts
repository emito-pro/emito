/**
 * Round-trip + FK-cascade + index tests for `emito_alert_history`.
 *
 * Verifies: prefixed-id generation (`ahi_`), numeric triggered_value round-trip,
 * the acknowledgement trail, the FK to `emito_alerts` rejects orphans and cascades
 * on parent delete, and the `(alert_id, triggered_at DESC)` index is used.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emito_alert_history } from "../../src/schema/alert-history";
import { emito_alerts } from "../../src/schema/alerts";
import { type TestDb, closeDb, explain, firstRow, getDb, hasDb } from "./_helpers";

let db: TestDb | undefined;

beforeAll(async () => {
	db = await getDb();
}, 60_000);

afterAll(async () => {
	await closeDb();
});

async function insertAlert(): Promise<string> {
	if (!hasDb(db)) throw new Error("no db");
	const alert = firstRow(
		await db
			.insert(emito_alerts)
			.values({
				name: `alert ${Date.now()}`,
				metric: "latency_p95",
				condition: { operator: "gt", threshold: 500, window: "5m" },
				severity: "warning",
				notify: { channels: ["email"], targets: ["ops@example.com"] },
			})
			.returning(),
	);
	return alert.id;
}

describe("emito_alert_history", () => {
	it("generates an ahi_ prefixed id and round-trips a numeric triggered_value", async () => {
		if (!hasDb(db)) return;
		const alertId = await insertAlert();

		const inserted = firstRow(
			await db.insert(emito_alert_history).values({ alertId, triggeredValue: "612.5" }).returning(),
		);

		expect(inserted.id).toMatch(/^ahi_/);

		const found = firstRow(
			await db.select().from(emito_alert_history).where(eq(emito_alert_history.id, inserted.id)),
		);
		// numeric round-trips as a string to preserve precision
		expect(found.triggeredValue).toBe("612.5");
		expect(found.resolvedAt).toBeNull();
		expect(found.acknowledgedAt).toBeNull();
	});

	it("persists the acknowledgement trail", async () => {
		if (!hasDb(db)) return;
		const alertId = await insertAlert();
		const ackBy = `user_ack_${Date.now()}`;
		const ackAt = new Date();

		const inserted = firstRow(
			await db
				.insert(emito_alert_history)
				.values({
					alertId,
					acknowledgedAt: ackAt,
					acknowledgedByUserId: ackBy,
					notes: "Investigated, transient provider blip.",
				})
				.returning(),
		);

		expect(inserted.acknowledgedByUserId).toBe(ackBy);
		expect(inserted.notes).toContain("transient");
	});

	it("rejects history rows referencing a non-existent alert (FK enforced)", async () => {
		if (!hasDb(db)) return;
		await expect(
			db.insert(emito_alert_history).values({ alertId: "alr_does_not_exist" }),
		).rejects.toThrow();
	});

	it("cascades delete from emito_alerts to its history", async () => {
		if (!hasDb(db)) return;
		const alertId = await insertAlert();
		await db.insert(emito_alert_history).values({ alertId });

		await db.delete(emito_alerts).where(eq(emito_alerts.id, alertId));

		const remaining = await db
			.select()
			.from(emito_alert_history)
			.where(eq(emito_alert_history.alertId, alertId));
		expect(remaining.length).toBe(0);
	});

	it("uses the (alert_id, triggered_at DESC) index for per-alert history lookups", async () => {
		if (!hasDb(db)) return;
		const alertId = await insertAlert();
		await db.insert(emito_alert_history).values({ alertId });

		const plan = await explain(
			db,
			`SELECT * FROM emito_alert_history WHERE alert_id = '${alertId}' ORDER BY triggered_at DESC`,
		);
		expect(plan).toContain("idx_emito_ahi_alert");
	});

	it("declares triggered_value as a numeric column", async () => {
		if (!hasDb(db)) return;
		const rows = await db.execute<{ data_type: string }>(
			sql`SELECT data_type FROM information_schema.columns WHERE table_name = 'emito_alert_history' AND column_name = 'triggered_value'`,
		);
		expect((rows[0] as { data_type: string }).data_type).toBe("numeric");
	});
});
