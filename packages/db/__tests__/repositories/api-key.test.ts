/**
 * Integration tests for {@link DrizzleApiKeyRepository} against a real PostgreSQL.
 * Covers active-prefix unique constraint, findByPrefix, touchUsage, rotate, idempotent revoke.
 */
import type { ApiKeyCreate } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { DrizzleApiKeyRepository } from "../../src/repositories/drizzle-api-key-repository";
import { dbAvailable, getDb, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

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

describe("DrizzleApiKeyRepository", () => {
	it("create stores hash/prefix with null lastUsedAt/revokedAt", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleApiKeyRepository(getDb());
		const record = await repo.create(input());
		expect(record.id).toMatch(/^apk_/);
		expect(record.lastUsedAt).toBeNull();
		expect(record.revokedAt).toBeNull();
	});

	it("create rejects a second active key with the same prefix (RESOURCE_CONFLICT)", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleApiKeyRepository(getDb());
		await repo.create(input());
		await expect(repo.create(input())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("create allows reusing a prefix once the prior key is revoked", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleApiKeyRepository(getDb());
		const first = await repo.create(input());
		await repo.revoke(first.id, new Date());
		await expect(repo.create(input())).resolves.toBeDefined();
	});

	it("findByPrefix returns only the active key", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleApiKeyRepository(getDb());
		const created = await repo.create(input());
		expect((await repo.findByPrefix("emk_live_aaaa"))?.id).toBe(created.id);
		await repo.revoke(created.id, new Date());
		expect(await repo.findByPrefix("emk_live_aaaa")).toBeNull();
	});

	it("touchUsage updates lastUsedAt and is a no-op for unknown ids", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleApiKeyRepository(getDb());
		const created = await repo.create(input());
		const at = new Date();
		await repo.touchUsage(created.id, at);
		expect((await repo.findById(created.id))?.lastUsedAt?.getTime()).toBe(at.getTime());
		await expect(repo.touchUsage("apk_x", at)).resolves.toBeUndefined();
	});

	it("rotate swaps hash/prefix in place; conflict + not-found are mapped", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleApiKeyRepository(getDb());
		const a = await repo.create(input({ keyPrefix: "emk_live_aaaa" }));
		await repo.create(input({ name: "second", keyPrefix: "emk_live_bbbb" }));

		const rotated = await repo.rotate(a.id, "$2b$10$new", "emk_live_cccc");
		expect(rotated.keyPrefix).toBe("emk_live_cccc");

		await expect(repo.rotate(a.id, "$2b$10$x", "emk_live_bbbb")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
		await expect(repo.rotate("apk_x", "$2b$10$x", "emk_live_zzzz")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("revoke is idempotent and errors only on unknown ids", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleApiKeyRepository(getDb());
		const created = await repo.create(input());
		const at = new Date();
		await repo.revoke(created.id, at);
		// Second revoke is a no-op and must not throw.
		await expect(repo.revoke(created.id, new Date())).resolves.toBeUndefined();
		await expect(repo.revoke("apk_x", new Date())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("list excludes revoked by default, includes when asked, paginates newest-first", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleApiKeyRepository(getDb());
		const a = await repo.create(input({ keyPrefix: "emk_live_aaaa" }));
		await tick();
		await repo.create(input({ name: "k2", keyPrefix: "emk_live_bbbb" }));
		await repo.revoke(a.id, new Date());

		expect((await repo.list({ limit: 50 })).total).toBe(1);
		expect((await repo.list({ limit: 50, includeRevoked: true })).total).toBe(2);

		const first = await repo.list({ limit: 1, includeRevoked: true });
		expect(first.hasMore).toBe(true);
		expect(first.total).toBe(2);
	});
});
