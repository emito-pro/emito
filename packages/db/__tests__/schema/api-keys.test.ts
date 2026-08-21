/**
 * Round-trip + partial-unique tests for `emito_api_keys`.
 *
 * Verifies: prefixed-id generation (`apk_`), the partial unique index on
 * `key_prefix WHERE revoked_at IS NULL` (one active key per prefix, but a prefix
 * may recur once the prior key is revoked), nullable `last_used_at`/`revoked_at`,
 * and that the lookup index on `key_prefix` is chosen for prefix lookups.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emito_api_keys } from "../../src/schema/api-keys";
import { type TestDb, closeDb, explain, firstRow, getDb, hasDb } from "./_helpers";

let db: TestDb | undefined;

beforeAll(async () => {
	db = await getDb();
}, 60_000);

afterAll(async () => {
	await closeDb();
});

function apiKey(overrides: Record<string, unknown> = {}) {
	return {
		name: `CI key ${Date.now()}`,
		keyHash: "$2b$10$abcdefghijklmnopqrstuv",
		keyPrefix: `emk_${Date.now().toString(36)}`,
		scope: "readonly",
		createdByUserId: `user_apk_${Date.now()}`,
		...overrides,
	};
}

describe("emito_api_keys", () => {
	it("generates an apk_ prefixed id and leaves last_used_at/revoked_at null", async () => {
		if (!hasDb(db)) return;
		const inserted = firstRow(await db.insert(emito_api_keys).values(apiKey()).returning());

		expect(inserted.id).toMatch(/^apk_/);
		expect(inserted.lastUsedAt).toBeNull();
		expect(inserted.revokedAt).toBeNull();
		expect(inserted.scope).toBe("readonly");
	});

	it("rejects a second active key with the same prefix (partial unique)", async () => {
		if (!hasDb(db)) return;
		const prefix = `dup_${Date.now().toString(36)}`;
		await db.insert(emito_api_keys).values(apiKey({ keyPrefix: prefix }));

		await expect(db.insert(emito_api_keys).values(apiKey({ keyPrefix: prefix }))).rejects.toThrow();
	});

	it("allows reusing a prefix once the prior key is revoked", async () => {
		if (!hasDb(db)) return;
		const prefix = `reuse_${Date.now().toString(36)}`;
		const first = firstRow(
			await db
				.insert(emito_api_keys)
				.values(apiKey({ keyPrefix: prefix }))
				.returning(),
		);

		// Revoke the first key — its row leaves the partial unique predicate.
		await db
			.update(emito_api_keys)
			.set({ revokedAt: new Date() })
			.where(eq(emito_api_keys.id, first.id));

		await expect(
			db.insert(emito_api_keys).values(apiKey({ keyPrefix: prefix })),
		).resolves.toBeDefined();
	});

	it("declares the active-prefix index as a partial UNIQUE index", async () => {
		if (!hasDb(db)) return;
		const rows = await db.execute<{ indexdef: string }>(
			sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'emito_api_keys_active_prefix_unique'`,
		);
		const def = (rows[0] as { indexdef: string } | undefined)?.indexdef ?? "";
		expect(def.toUpperCase()).toContain("UNIQUE INDEX");
		expect(def.toLowerCase()).toContain("where");
		expect(def.toLowerCase()).toContain("revoked_at is null");
	});

	it("uses a key_prefix index for prefix lookups", async () => {
		if (!hasDb(db)) return;
		await db.insert(emito_api_keys).values(apiKey({ keyPrefix: "explain_lookup" }));

		const plan = await explain(
			db,
			"SELECT * FROM emito_api_keys WHERE key_prefix = 'explain_lookup'",
		);
		expect(plan.toLowerCase()).toContain("index");
		expect(plan).toContain("key_prefix");
	});
});
