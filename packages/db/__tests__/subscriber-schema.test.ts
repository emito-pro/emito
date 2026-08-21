/**
 * Tests for subscriber schema alignment.
 *
 * Behavior verified here:
 * - DB column renamed: locale → lang (lang maps directly in mapRow)
 * - New nullable locale column (BCP 47) exists and round-trips
 * - Single flattened migration includes the correct schema
 * - Drizzle repo maps lang directly (no rename), persists/returns locale
 *
 * Tests run against a real PostgreSQL 16 instance via Testcontainers.
 * Container is started in global-setup.ts; this file uses the injected DB_URI.
 * Each test has a clean slate via beforeEach table truncation (see test-setup.ts).
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { DrizzleDb } from "../src/repositories/db-type";
import { DrizzleSubscriberRepository } from "../src/repositories/index";

let pgClient: ReturnType<typeof postgres>;
// biome-ignore lint/suspicious/noExplicitAny: DrizzleDb is PgDatabase<any>
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
// Helper builders (rule 7: no inline object literals)
// ---------------------------------------------------------------------------

function subscriberData(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		email: `${id}@example.com`,
		...overrides,
	};
}

// ===========================================================================
// DrizzleSubscriberRepository — lang column (renamed from locale)
// ===========================================================================

describe("DrizzleSubscriberRepository — lang column alignment", () => {
	describe("lang field", () => {
		it("should return lang on created subscriber when lang is provided", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			const created = await repo.create(subscriberData("sub_018_lang_1", { lang: "pl" }));

			expect(created.lang).toBe("pl");
		});

		it("should default lang to 'en' when not provided", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			const created = await repo.create(subscriberData("sub_018_lang_default"));

			// lang column has DEFAULT 'en' in the schema
			expect(created.lang).toBe("en");
		});

		it("should persist lang and retrieve it via findById without rename", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			await repo.create(subscriberData("sub_018_lang_roundtrip", { lang: "de" }));

			const found = await repo.findById("sub_018_lang_roundtrip");
			// mapRow must map row.lang → lang directly (no locale → lang rename)
			expect(found?.lang).toBe("de");
		});

		it("should NOT expose a 'locale' field in place of 'lang' (no old rename in mapRow)", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			const created = await repo.create(subscriberData("sub_018_no_rename", { lang: "fr" }));

			// If mapRow still renames locale→lang, then lang would be undefined (reading wrong column)
			// or the old locale column default would bleed through.
			// Asserting lang is set correctly confirms direct mapping works.
			expect(created.lang).toBe("fr");
			expect(created.lang).not.toBeUndefined();
		});
	});

	// ===========================================================================
	// locale column (new BCP 47 column)
	// ===========================================================================

	describe("locale column (new BCP 47 column)", () => {
		it("should persist locale and return it on created subscriber", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			const created = await repo.create(
				subscriberData("sub_018_locale_1", { lang: "en", locale: "en-US" }),
			);

			expect(created.locale).toBe("en-US");
		});

		it("should allow locale to be undefined (nullable column)", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			const created = await repo.create(subscriberData("sub_018_locale_null"));

			// locale is nullable with no default
			expect(created.locale).toBeUndefined();
		});

		it("should round-trip locale through create and findById", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			await repo.create(subscriberData("sub_018_locale_rt", { lang: "pl", locale: "pl-PL" }));

			const found = await repo.findById("sub_018_locale_rt");
			expect(found?.locale).toBe("pl-PL");
			expect(found?.lang).toBe("pl");
		});

		it("should round-trip locale through create and list", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			await repo.create(subscriberData("sub_018_locale_list", { lang: "de", locale: "de-DE" }));

			const result = await repo.list();
			const item = result.items.find((s) => s.id === "sub_018_locale_list");
			expect(item).toBeDefined();
			expect(item?.locale).toBe("de-DE");
		});

		it("should preserve other BCP 47 locale subtag formats", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			await repo.create(subscriberData("sub_018_locale_subtag", { locale: "zh-Hant-TW" }));

			const found = await repo.findById("sub_018_locale_subtag");
			expect(found?.locale).toBe("zh-Hant-TW");
		});
	});

	// ===========================================================================
	// Migration — verify the schema has the correct columns
	// ===========================================================================

	describe("migration schema validation", () => {
		it("should have lang column in emito_subscribers table", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			// If the lang column does not exist, create() would fail or return undefined lang.
			// A successful create with lang proves the column exists.
			const created = await repo.create(subscriberData("sub_018_schema_lang", { lang: "es" }));
			expect(created.lang).toBe("es");
		});

		it("should have locale column in emito_subscribers table", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			// If locale column does not exist, create() with locale would fail or lose the value.
			const created = await repo.create(
				subscriberData("sub_018_schema_locale", { locale: "es-ES" }),
			);
			expect(created.locale).toBe("es-ES");
		});

		it("should handle both lang and locale independently in the same record", async () => {
			if (!hasDb()) return;
			const repo = new DrizzleSubscriberRepository(db);

			const created = await repo.create(
				subscriberData("sub_018_both_cols", { lang: "pt", locale: "pt-BR" }),
			);

			expect(created.lang).toBe("pt");
			expect(created.locale).toBe("pt-BR");

			const found = await repo.findById("sub_018_both_cols");
			expect(found?.lang).toBe("pt");
			expect(found?.locale).toBe("pt-BR");
		});
	});
});
