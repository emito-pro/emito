import { EMITO_ERROR_CODE } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { SavedViewCreate } from "../../src/index";
import { InMemorySavedViewRepository } from "../../src/index";

function input(overrides: Partial<SavedViewCreate> = {}): SavedViewCreate {
	return {
		name: "Failures",
		page: "activity",
		createdByUserId: "user_1",
		...overrides,
	};
}

describe("InMemorySavedViewRepository", () => {
	let repo: InMemorySavedViewRepository;

	beforeEach(() => {
		repo = new InMemorySavedViewRepository();
	});

	it("create defaults scope=private and filters={}", async () => {
		const record = await repo.create(input());
		expect(record.id).toMatch(/^sav_mem_/);
		expect(record.scope).toBe("private");
		expect(record.filters).toEqual({});
	});

	it("create honours explicit scope and filters", async () => {
		const record = await repo.create(input({ scope: "team", filters: { status: "failed" } }));
		expect(record.scope).toBe("team");
		expect(record.filters).toEqual({ status: "failed" });
	});

	it("create rejects duplicate (user, name, page) with RESOURCE_CONFLICT", async () => {
		await repo.create(input());
		await expect(repo.create(input())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("create allows same name on a different page or for a different user", async () => {
		await repo.create(input());
		await expect(repo.create(input({ page: "subscribers" }))).resolves.toBeDefined();
		await expect(repo.create(input({ createdByUserId: "user_2" }))).resolves.toBeDefined();
	});

	it("list is user-scoped and can narrow by page", async () => {
		await repo.create(input({ name: "v1", page: "activity" }));
		await repo.create(input({ name: "v2", page: "subscribers" }));
		await repo.create(input({ name: "v3", page: "activity", createdByUserId: "user_2" }));

		expect((await repo.list({ userId: "user_1", limit: 50 })).total).toBe(2);
		expect((await repo.list({ userId: "user_1", page: "activity", limit: 50 })).total).toBe(1);
		expect((await repo.list({ userId: "user_2", limit: 50 })).total).toBe(1);
	});

	it("list paginates newest-first with accurate total", async () => {
		for (let i = 0; i < 3; i++) {
			await repo.create(input({ name: `v${i}` }));
			await new Promise((r) => setTimeout(r, 2));
		}
		const first = await repo.list({ userId: "user_1", limit: 2 });
		expect(first.total).toBe(3);
		expect(first.hasMore).toBe(true);
		const second = await repo.list({ userId: "user_1", limit: 2, cursor: first.cursor });
		expect(second.hasMore).toBe(false);
		expect(second.items).toHaveLength(1);
	});

	it("update patches name/filters/scope and refreshes updatedAt", async () => {
		const created = await repo.create(input());
		const updated = await repo.update(created.id, { name: "Renamed", scope: "team" });
		expect(updated.name).toBe("Renamed");
		expect(updated.scope).toBe("team");
	});

	it("update on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.update("sav_x", { name: "X" })).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("delete removes the record; deleting twice throws RESOURCE_NOT_FOUND", async () => {
		const created = await repo.create(input());
		await repo.delete(created.id);
		expect(await repo.findById(created.id)).toBeNull();
		await expect(repo.delete(created.id)).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("findById returns record or null", async () => {
		const created = await repo.create(input());
		expect(await repo.findById(created.id)).toEqual(created);
		expect(await repo.findById("sav_x")).toBeNull();
	});
});
