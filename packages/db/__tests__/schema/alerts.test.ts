/**
 * Round-trip + index tests for `emito_alerts`.
 *
 * Verifies: prefixed-id generation (`alr_`), `enabled` defaults to true,
 * JSONB condition/notify round-trip, nullable escalation/maintenance, and the
 * partial `(enabled, metric) WHERE enabled=true` index is chosen for enabled-rule
 * lookups.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emito_alerts } from "../../src/schema/alerts";
import { type TestDb, closeDb, explain, firstRow, getDb, hasDb } from "./_helpers";

let db: TestDb | undefined;

beforeAll(async () => {
	db = await getDb();
}, 60_000);

afterAll(async () => {
	await closeDb();
});

function alertRule(overrides: Record<string, unknown> = {}) {
	return {
		name: `Bounce spike ${Date.now()}`,
		metric: "bounce_rate",
		condition: { operator: "gt", threshold: 0.05, window: "5m" },
		severity: "critical",
		notify: { channels: ["email", "slack"], targets: ["ops@example.com", "#alerts"] },
		...overrides,
	};
}

describe("emito_alerts", () => {
	it("generates an alr_ prefixed id and defaults enabled to true", async () => {
		if (!hasDb(db)) return;
		const inserted = firstRow(await db.insert(emito_alerts).values(alertRule()).returning());

		expect(inserted.id).toMatch(/^alr_/);
		expect(inserted.enabled).toBe(true);
		expect(inserted.lastTriggeredAt).toBeNull();
	});

	it("round-trips condition and notify JSONB and allows null escalation/maintenance", async () => {
		if (!hasDb(db)) return;
		const condition = { operator: "gte", threshold: 100, window: "1h" };
		const notify = { channels: ["webhook"], targets: ["https://hooks.example.com/x"] };

		const inserted = firstRow(
			await db
				.insert(emito_alerts)
				.values(alertRule({ condition, notify, metric: "dlq_depth" }))
				.returning(),
		);

		const found = firstRow(
			await db.select().from(emito_alerts).where(eq(emito_alerts.id, inserted.id)),
		);
		expect(found.condition).toEqual(condition);
		expect(found.notify).toEqual(notify);
		expect(found.escalation).toBeNull();
		expect(found.maintenance).toBeNull();
	});

	it("persists escalation and maintenance windows when provided", async () => {
		if (!hasDb(db)) return;
		const escalation = { afterMinutes: 15, channel: "slack", target: "#oncall" };
		const maintenance = { cron: "0 2 * * *", durationMs: 3_600_000 };

		const inserted = firstRow(
			await db.insert(emito_alerts).values(alertRule({ escalation, maintenance })).returning(),
		);

		expect(inserted.escalation).toEqual(escalation);
		expect(inserted.maintenance).toEqual(maintenance);
	});

	it("uses the partial enabled-metric index for enabled-rule lookups", async () => {
		if (!hasDb(db)) return;
		await db.insert(emito_alerts).values(alertRule({ metric: "error_rate" }));

		const plan = await explain(
			db,
			"SELECT * FROM emito_alerts WHERE enabled = true AND metric = 'error_rate'",
		);
		expect(plan).toContain("idx_emito_alr_enabled_metric");
	});

	it("declares the enabled-metric index as partial (WHERE enabled = true)", async () => {
		if (!hasDb(db)) return;
		const rows = await db.execute<{ indexdef: string }>(
			sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_emito_alr_enabled_metric'`,
		);
		const def = (rows[0] as { indexdef: string } | undefined)?.indexdef ?? "";
		expect(def.toLowerCase()).toContain("where");
		expect(def.toLowerCase()).toContain("enabled");
	});
});
