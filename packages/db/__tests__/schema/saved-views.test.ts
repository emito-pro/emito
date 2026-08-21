/**
 * Round-trip + uniqueness tests for `emito_saved_views`.
 *
 * Verifies: prefixed-id generation (`sav_`), `scope` defaults to `private`,
 * `filters` JSONB round-trip, the unique constraint on
 * `(created_by_user_id, name, page)`, and that the same name is reusable across
 * different pages and across different users.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emito_saved_views } from "../../src/schema/saved-views";
import { type TestDb, closeDb, firstRow, getDb, hasDb } from "./_helpers";

let db: TestDb | undefined;

beforeAll(async () => {
	db = await getDb();
}, 60_000);

afterAll(async () => {
	await closeDb();
});

function savedView(overrides: Record<string, unknown> = {}) {
	return {
		name: `High bounces ${Date.now()}`,
		page: "activity",
		filters: { status: ["bounced"], channel: ["email"] },
		createdByUserId: `user_sav_${Date.now()}`,
		...overrides,
	};
}

describe("emito_saved_views", () => {
	it("generates a sav_ prefixed id, defaults scope to private, and round-trips filters", async () => {
		if (!hasDb(db)) return;
		const filters = { status: ["bounced", "failed"], from: "2026-01-01" };

		const inserted = firstRow(
			await db.insert(emito_saved_views).values(savedView({ filters })).returning(),
		);

		expect(inserted.id).toMatch(/^sav_/);
		expect(inserted.scope).toBe("private");

		const found = firstRow(
			await db.select().from(emito_saved_views).where(eq(emito_saved_views.id, inserted.id)),
		);
		expect(found.filters).toEqual(filters);
	});

	it("persists team scope when supplied", async () => {
		if (!hasDb(db)) return;
		const inserted = firstRow(
			await db
				.insert(emito_saved_views)
				.values(savedView({ scope: "team" }))
				.returning(),
		);
		expect(inserted.scope).toBe("team");
	});

	it("enforces unique (created_by_user_id, name, page)", async () => {
		if (!hasDb(db)) return;
		const user = `user_uniq_${Date.now()}`;
		await db
			.insert(emito_saved_views)
			.values(savedView({ createdByUserId: user, name: "Dupe", page: "subscribers" }));

		await expect(
			db
				.insert(emito_saved_views)
				.values(savedView({ createdByUserId: user, name: "Dupe", page: "subscribers" })),
		).rejects.toThrow();
	});

	it("allows the same name on a different page for the same user", async () => {
		if (!hasDb(db)) return;
		const user = `user_pages_${Date.now()}`;
		await db
			.insert(emito_saved_views)
			.values(savedView({ createdByUserId: user, name: "Shared", page: "activity" }));

		await expect(
			db
				.insert(emito_saved_views)
				.values(savedView({ createdByUserId: user, name: "Shared", page: "audit-log" })),
		).resolves.toBeDefined();
	});

	it("allows the same name+page for a different user", async () => {
		if (!hasDb(db)) return;
		await db
			.insert(emito_saved_views)
			.values(
				savedView({ createdByUserId: `user_a_${Date.now()}`, name: "Common", page: "suppression" }),
			);

		await expect(
			db
				.insert(emito_saved_views)
				.values(
					savedView({
						createdByUserId: `user_b_${Date.now()}`,
						name: "Common",
						page: "suppression",
					}),
				),
		).resolves.toBeDefined();
	});
});
