/**
 * Round-trip + uniqueness + index tests for `emito_template_overrides`.
 *
 * Verifies: prefixed-id generation (`tmo_`), nullable `compiled_warning`, source
 * round-trip, the unique constraint on `(event_key, channel, locale, version)`
 * (versions are append-only), and that the lookup index resolves the latest
 * version of an override.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emito_template_overrides } from "../../src/schema/template-overrides";
import { type TestDb, closeDb, explain, firstRow, getDb, hasDb } from "./_helpers";

let db: TestDb | undefined;

beforeAll(async () => {
	db = await getDb();
}, 60_000);

afterAll(async () => {
	await closeDb();
});

function templateOverride(overrides: Record<string, unknown> = {}) {
	const user = `user_tmo_${Date.now()}`;
	return {
		eventKey: `order.shipped.${Date.now()}`,
		channel: "email",
		locale: "en-US",
		source: "<mjml>Hi {{name}}</mjml>",
		version: 1,
		createdByUserId: user,
		updatedByUserId: user,
		...overrides,
	};
}

describe("emito_template_overrides", () => {
	it("generates a tmo_ prefixed id, round-trips source, and leaves compiled_warning null", async () => {
		if (!hasDb(db)) return;
		const source = "<mjml><mj-body>Hello {{first_name}}</mj-body></mjml>";

		const inserted = firstRow(
			await db.insert(emito_template_overrides).values(templateOverride({ source })).returning(),
		);

		expect(inserted.id).toMatch(/^tmo_/);
		expect(inserted.compiledWarning).toBeNull();

		const found = firstRow(
			await db
				.select()
				.from(emito_template_overrides)
				.where(eq(emito_template_overrides.id, inserted.id)),
		);
		expect(found.source).toBe(source);
		expect(found.version).toBe(1);
	});

	it("persists a compiled_warning when present", async () => {
		if (!hasDb(db)) return;
		const inserted = firstRow(
			await db
				.insert(emito_template_overrides)
				.values(templateOverride({ compiledWarning: "Unknown variable {{foo}}" }))
				.returning(),
		);
		expect(inserted.compiledWarning).toContain("Unknown variable");
	});

	it("enforces unique (event_key, channel, locale, version)", async () => {
		if (!hasDb(db)) return;
		const eventKey = `evt.dup.${Date.now()}`;
		await db.insert(emito_template_overrides).values(templateOverride({ eventKey, version: 1 }));

		await expect(
			db.insert(emito_template_overrides).values(templateOverride({ eventKey, version: 1 })),
		).rejects.toThrow();
	});

	it("allows a new version of the same (event, channel, locale)", async () => {
		if (!hasDb(db)) return;
		const eventKey = `evt.versioned.${Date.now()}`;
		await db.insert(emito_template_overrides).values(templateOverride({ eventKey, version: 1 }));

		await expect(
			db.insert(emito_template_overrides).values(templateOverride({ eventKey, version: 2 })),
		).resolves.toBeDefined();
	});

	it("resolves the latest version via an index scan (not a seq scan)", async () => {
		if (!hasDb(db)) return;
		const eventKey = `evt.lookup.${Date.now()}`;
		await db.insert(emito_template_overrides).values(templateOverride({ eventKey, version: 1 }));
		await db.insert(emito_template_overrides).values(templateOverride({ eventKey, version: 2 }));

		const plan = await explain(
			db,
			`SELECT * FROM emito_template_overrides WHERE event_key = '${eventKey}' AND channel = 'email' AND locale = 'en-US' ORDER BY version DESC LIMIT 1`,
		);
		// Both the dedicated lookup index and the (event,channel,locale,version) unique
		// index cover this query identically; PostgreSQL may pick either. The contract is
		// that the resolution is index-backed (no seq scan), and that the dedicated lookup
		// index exists for the case where the unique constraint is later dropped.
		expect(plan.toLowerCase()).toContain("index scan");
		expect(plan.toLowerCase()).not.toContain("seq scan");
	});

	it("declares the dedicated lookup index over (event_key, channel, locale, version DESC)", async () => {
		if (!hasDb(db)) return;
		const rows = await db.execute<{ indexdef: string }>(
			sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_emito_tmo_lookup'`,
		);
		const def = (rows[0] as { indexdef: string } | undefined)?.indexdef ?? "";
		expect(def).toContain("event_key");
		expect(def).toContain("channel");
		expect(def).toContain("locale");
		expect(def.toLowerCase()).toContain("version desc");
	});

	it("declares the unique constraint over all four columns", async () => {
		if (!hasDb(db)) return;
		const rows = await db.execute<{ column_name: string }>(sql`
			SELECT kcu.column_name
			FROM information_schema.table_constraints AS tc
			JOIN information_schema.key_column_usage AS kcu
				ON tc.constraint_name = kcu.constraint_name
			WHERE tc.constraint_type = 'UNIQUE'
				AND tc.table_name = 'emito_template_overrides'
				AND tc.constraint_name = 'emito_template_overrides_event_channel_locale_version_unique'
		`);
		const cols = rows.map((r) => (r as { column_name: string }).column_name);
		expect(cols).toEqual(expect.arrayContaining(["event_key", "channel", "locale", "version"]));
	});
});
