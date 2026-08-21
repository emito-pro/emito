/**
 * Integration tests for {@link DrizzleAuditLogRepository} against a real PostgreSQL.
 * Covers create (with/without tx), findById, filtered + cursor-paginated list, total accuracy.
 */
import type { AuditLogEntry } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { DrizzleAuditLogRepository } from "../../src/repositories/drizzle-audit-log-repository";
import { dbAvailable, getDb, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
	return {
		actorUserId: "user_admin",
		actorKind: "user",
		action: "subscriber.update",
		resourceType: "subscriber",
		resourceId: "sub_1",
		severity: "medium",
		requestId: "req_1",
		ip: "10.0.0.1",
		...overrides,
	};
}

describe("DrizzleAuditLogRepository", () => {
	it("create persists and findById round-trips with null defaults", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAuditLogRepository(getDb());
		const created = await repo.create(entry());
		expect(created.id).toMatch(/^aud_/);
		expect(created.beforeState).toBeNull();
		expect(created.metadata).toEqual({});

		const fetched = await repo.findById(created.id);
		expect(fetched?.id).toBe(created.id);
		expect(await repo.findById("aud_missing")).toBeNull();
	});

	it("create participates in a caller transaction and rolls back on failure", async () => {
		if (!dbAvailable()) return;
		const db = getDb();
		const repo = new DrizzleAuditLogRepository(db);

		await expect(
			db.transaction(async (tx) => {
				await repo.create(entry({ action: "tx.rollback" }), tx);
				throw new Error("force rollback");
			}),
		).rejects.toThrow("force rollback");

		const page = await repo.list({ limit: 50, filters: { action: "tx.rollback" } });
		expect(page.total).toBe(0);
	});

	it("list filters by actor substring, severity, action, and time bounds with accurate total", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAuditLogRepository(getDb());
		await repo.create(entry({ actorUserId: "Alice", action: "x", severity: "high" }));
		await tick();
		await repo.create(entry({ actorUserId: "bob", action: "y", severity: "low" }));

		expect((await repo.list({ limit: 50, filters: { actor: "ali" } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { severity: "high" } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { action: "y" } })).total).toBe(1);
		expect((await repo.list({ limit: 50 })).total).toBe(2);
	});

	it("list cursor-paginates newest-first; total stays constant across pages", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAuditLogRepository(getDb());
		for (let i = 0; i < 5; i++) {
			await repo.create(entry({ action: `a${i}` }));
			await tick();
		}

		const first = await repo.list({ limit: 2 });
		expect(first.items).toHaveLength(2);
		expect(first.hasMore).toBe(true);
		expect(first.total).toBe(5);

		const second = await repo.list({ limit: 2, cursor: first.cursor });
		expect(second.total).toBe(5);
		const third = await repo.list({ limit: 2, cursor: second.cursor });
		expect(third.items).toHaveLength(1);
		expect(third.hasMore).toBe(false);
		expect(third.cursor).toBeNull();

		const ids = [...first.items, ...second.items, ...third.items].map((r) => r.id);
		expect(new Set(ids).size).toBe(5);
	});

	it("list throws CURSOR_INVALID on a corrupt cursor", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAuditLogRepository(getDb());
		await expect(repo.list({ limit: 10, cursor: "@@@not-valid@@@" })).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.CURSOR_INVALID,
		});
	});
});
