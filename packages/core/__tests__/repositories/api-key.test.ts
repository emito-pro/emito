import { EMITO_ERROR_CODE } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { ApiKeyCreate } from "../../src/index";
import { InMemoryApiKeyRepository } from "../../src/index";

function input(overrides: Partial<ApiKeyCreate> = {}): ApiKeyCreate {
	return {
		name: "CI key",
		keyHash: "$2b$10$hashvalue",
		keyPrefix: "emk_live_aaaa",
		scope: "full",
		createdByUserId: "user_1",
		...overrides,
	};
}

describe("InMemoryApiKeyRepository", () => {
	let repo: InMemoryApiKeyRepository;

	beforeEach(() => {
		repo = new InMemoryApiKeyRepository();
	});

	it("create stores hash/prefix, defaults lastUsedAt and revokedAt to null", async () => {
		const record = await repo.create(input());
		expect(record.id).toMatch(/^apk_mem_/);
		expect(record.keyHash).toBe("$2b$10$hashvalue");
		expect(record.lastUsedAt).toBeNull();
		expect(record.revokedAt).toBeNull();
	});

	it("create rejects a second active key with the same prefix (RESOURCE_CONFLICT)", async () => {
		await repo.create(input());
		await expect(repo.create(input())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("create allows reusing a prefix once the prior key is revoked", async () => {
		const first = await repo.create(input());
		await repo.revoke(first.id, new Date());
		await expect(repo.create(input())).resolves.toBeDefined();
	});

	it("findByPrefix returns only the active key", async () => {
		const created = await repo.create(input());
		expect((await repo.findByPrefix("emk_live_aaaa"))?.id).toBe(created.id);
		await repo.revoke(created.id, new Date());
		expect(await repo.findByPrefix("emk_live_aaaa")).toBeNull();
	});

	it("touchUsage updates lastUsedAt and is a no-op for unknown ids", async () => {
		const created = await repo.create(input());
		const at = new Date();
		await repo.touchUsage(created.id, at);
		expect((await repo.findById(created.id))?.lastUsedAt).toEqual(at);
		await expect(repo.touchUsage("apk_x", at)).resolves.toBeUndefined();
	});

	it("rotate swaps hash/prefix in place, keeping the id", async () => {
		const created = await repo.create(input());
		const rotated = await repo.rotate(created.id, "$2b$10$new", "emk_live_bbbb");
		expect(rotated.id).toBe(created.id);
		expect(rotated.keyHash).toBe("$2b$10$new");
		expect(rotated.keyPrefix).toBe("emk_live_bbbb");
	});

	it("rotate into an already-active prefix throws RESOURCE_CONFLICT", async () => {
		const a = await repo.create(input({ keyPrefix: "emk_live_aaaa" }));
		await repo.create(input({ name: "second", keyPrefix: "emk_live_bbbb" }));
		await expect(repo.rotate(a.id, "$2b$10$x", "emk_live_bbbb")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("rotate on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.rotate("apk_x", "$2b$10$x", "emk_live_zzzz")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("revoke stamps revokedAt and is idempotent", async () => {
		const created = await repo.create(input());
		const at = new Date();
		await repo.revoke(created.id, at);
		expect((await repo.findById(created.id))?.revokedAt).toEqual(at);
		// Second revoke is a no-op, does not overwrite the original timestamp.
		await repo.revoke(created.id, new Date(at.getTime() + 1000));
		expect((await repo.findById(created.id))?.revokedAt).toEqual(at);
	});

	it("revoke on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.revoke("apk_x", new Date())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("list excludes revoked keys by default and includes them when asked", async () => {
		const a = await repo.create(input({ keyPrefix: "emk_live_aaaa" }));
		await repo.create(input({ name: "k2", keyPrefix: "emk_live_bbbb" }));
		await repo.revoke(a.id, new Date());

		expect((await repo.list({ limit: 50 })).total).toBe(1);
		expect((await repo.list({ limit: 50, includeRevoked: true })).total).toBe(2);
	});

	it("list paginates newest-first with accurate total", async () => {
		for (let i = 0; i < 3; i++) {
			await repo.create(input({ name: `k${i}`, keyPrefix: `emk_live_${i}` }));
			await new Promise((r) => setTimeout(r, 2));
		}
		const first = await repo.list({ limit: 2 });
		expect(first.total).toBe(3);
		expect(first.hasMore).toBe(true);
		const second = await repo.list({ limit: 2, cursor: first.cursor });
		expect(second.hasMore).toBe(false);
		expect(second.items).toHaveLength(1);
	});
});
