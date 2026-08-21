/**
 * Integration tests for {@link DrizzleSavedViewRepository} against a real PostgreSQL.
 * Covers create defaults, unique-constraint conflict mapping, user-scoped list, update, delete.
 */
import type { SavedViewCreate } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { DrizzleSavedViewRepository } from "../../src/repositories/drizzle-saved-view-repository";
import { dbAvailable, getDb, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

function input(overrides: Partial<SavedViewCreate> = {}): SavedViewCreate {
	return {
		name: "Failures",
		page: "activity",
		createdByUserId: "user_1",
		...overrides,
	};
}

describe("DrizzleSavedViewRepository", () => {
	it("create defaults scope=private and filters={}", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSavedViewRepository(getDb());
		const record = await repo.create(input());
		expect(record.id).toMatch(/^sav_/);
		expect(record.scope).toBe("private");
		expect(record.filters).toEqual({});
	});

	it("create maps the unique (user,name,page) violation to RESOURCE_CONFLICT", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSavedViewRepository(getDb());
		await repo.create(input());
		await expect(repo.create(input())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("create allows the same name on a different page / for a different user", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSavedViewRepository(getDb());
		await repo.create(input());
		await expect(repo.create(input({ page: "subscribers" }))).resolves.toBeDefined();
		await expect(repo.create(input({ createdByUserId: "user_2" }))).resolves.toBeDefined();
	});

	it("list is user-scoped, narrows by page, paginates newest-first", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSavedViewRepository(getDb());
		await repo.create(input({ name: "v1", page: "activity" }));
		await tick();
		await repo.create(input({ name: "v2", page: "subscribers" }));
		await repo.create(input({ name: "v3", page: "activity", createdByUserId: "user_2" }));

		expect((await repo.list({ userId: "user_1", limit: 50 })).total).toBe(2);
		expect((await repo.list({ userId: "user_1", page: "activity", limit: 50 })).total).toBe(1);
		expect((await repo.list({ userId: "user_2", limit: 50 })).total).toBe(1);

		const first = await repo.list({ userId: "user_1", limit: 1 });
		expect(first.hasMore).toBe(true);
		expect(first.total).toBe(2);
	});

	it("update patches name/scope; unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSavedViewRepository(getDb());
		const created = await repo.create(input());
		const updated = await repo.update(created.id, { name: "Renamed", scope: "team" });
		expect(updated.name).toBe("Renamed");
		expect(updated.scope).toBe("team");
		await expect(repo.update("sav_x", { name: "X" })).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("delete removes the row; deleting twice throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSavedViewRepository(getDb());
		const created = await repo.create(input());
		await repo.delete(created.id);
		expect(await repo.findById(created.id)).toBeNull();
		await expect(repo.delete(created.id)).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});
});
