/**
 * Integration tests for {@link DrizzleTemplateOverrideRepository} against a real PostgreSQL.
 * Covers auto-version bump per triple, findActive (latest), history ordering, gallery distinctness.
 */
import type { TemplateOverrideCreate } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { DrizzleTemplateOverrideRepository } from "../../src/repositories/drizzle-template-override-repository";
import { dbAvailable, getDb, setupAdminTestDb } from "./admin-test-db";

setupAdminTestDb();

function input(overrides: Partial<TemplateOverrideCreate> = {}): TemplateOverrideCreate {
	return {
		eventKey: "user.welcome",
		channel: "email",
		locale: "en",
		source: "<h1>Hello</h1>",
		createdByUserId: "user_1",
		updatedByUserId: "user_1",
		...overrides,
	};
}

describe("DrizzleTemplateOverrideRepository", () => {
	it("create auto-bumps version per (event, channel, locale)", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTemplateOverrideRepository(getDb());
		const v1 = await repo.create(input({ source: "v1" }));
		const v2 = await repo.create(input({ source: "v2" }));
		const v3 = await repo.create(input({ source: "v3" }));
		expect(v1.version).toBe(1);
		expect(v2.version).toBe(2);
		expect(v3.version).toBe(3);
	});

	it("create versions are independent across triples", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTemplateOverrideRepository(getDb());
		const en = await repo.create(input({ locale: "en" }));
		const pl = await repo.create(input({ locale: "pl" }));
		expect(en.version).toBe(1);
		expect(pl.version).toBe(1);
	});

	it("findActive returns the highest version, null when absent", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTemplateOverrideRepository(getDb());
		await repo.create(input({ source: "v1" }));
		const v2 = await repo.create(input({ source: "v2" }));
		const active = await repo.findActive("user.welcome", "email", "en");
		expect(active?.id).toBe(v2.id);
		expect(active?.version).toBe(2);
		expect(await repo.findActive("user.welcome", "sms", "en")).toBeNull();
	});

	it("create preserves compiledWarning", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTemplateOverrideRepository(getDb());
		const record = await repo.create(input({ compiledWarning: "unclosed tag" }));
		expect(record.compiledWarning).toBe("unclosed tag");
	});

	it("history returns newest-version-first, capped at limit", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTemplateOverrideRepository(getDb());
		await repo.create(input({ source: "v1" }));
		await repo.create(input({ source: "v2" }));
		await repo.create(input({ source: "v3" }));

		const all = await repo.history("user.welcome", "email", "en", 10);
		expect(all.map((r) => r.version)).toEqual([3, 2, 1]);
		const capped = await repo.history("user.welcome", "email", "en", 2);
		expect(capped.map((r) => r.version)).toEqual([3, 2]);
	});

	it("listGallery returns one present-custom cell per distinct triple", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTemplateOverrideRepository(getDb());
		await repo.create(input({ locale: "en", source: "v1" }));
		await repo.create(input({ locale: "en", source: "v2" }));
		await repo.create(input({ channel: "sms", locale: "en", source: "sms-v1" }));

		const gallery = await repo.listGallery();
		expect(gallery).toHaveLength(2);
		for (const cell of gallery) {
			expect(cell.status).toBe("present-custom");
			expect(cell.updatedAt).toBeInstanceOf(Date);
		}
	});

	it("listGallery is empty when no overrides exist", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTemplateOverrideRepository(getDb());
		expect(await repo.listGallery()).toHaveLength(0);
	});

	it("create re-maps a concurrent unique-version collision (23505) to RESOURCE_CONFLICT", async () => {
		if (!dbAvailable()) return;
		const realDb = getDb();

		// Seed version 1 for the triple so a second insert at version 1 collides
		// on the (eventKey, channel, locale, version) unique index.
		await new DrizzleTemplateOverrideRepository(realDb).create(input({ source: "v1" }));

		// Wrap the db so the in-transaction `max(version)` lookup returns a stale
		// 0 (→ nextVersion = 1), forcing the INSERT to hit the existing version-1
		// row and raise Postgres SQLSTATE 23505 — exactly the lost-update race the
		// production code guards against. The real INSERT still runs, so the unique
		// index is the thing that fires.
		const staleDb = {
			...realDb,
			transaction: (cb: (tx: unknown) => Promise<unknown>) =>
				realDb.transaction((tx) => {
					const txProxy = new Proxy(tx, {
						get(target, prop, receiver) {
							if (prop === "select") {
								return () => ({
									from: () => ({
										where: async () => [{ max: 0 }],
									}),
								});
							}
							return Reflect.get(target, prop, receiver);
						},
					});
					return cb(txProxy);
				}),
		} as unknown as typeof realDb;

		const repo = new DrizzleTemplateOverrideRepository(staleDb);

		await expect(repo.create(input({ source: "collision" }))).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
			isRetryable: true,
		});
	});
});
