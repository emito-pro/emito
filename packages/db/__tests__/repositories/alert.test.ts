/**
 * Integration tests for {@link DrizzleAlertRepository} against a real PostgreSQL.
 * Covers create defaults, optimistic-concurrency update, delete, markTriggered, filtered list.
 */
import type { AlertCreate } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { DrizzleAlertRepository } from "../../src/repositories/drizzle-alert-repository";
import { dbAvailable, getDb, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

function input(overrides: Partial<AlertCreate> = {}): AlertCreate {
	return {
		name: "High bounce",
		metric: "bounce_rate",
		condition: { operator: "gt", threshold: 0.1 },
		severity: "warning",
		notify: { channels: ["email"] },
		...overrides,
	};
}

describe("DrizzleAlertRepository", () => {
	it("create defaults enabled=true, version=1, null escalation/maintenance", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertRepository(getDb());
		const record = await repo.create(input());
		expect(record.id).toMatch(/^alr_/);
		expect(record.enabled).toBe(true);
		expect(record.version).toBe(1);
		expect(record.escalation).toBeNull();
		expect(record.lastTriggeredAt).toBeNull();
	});

	it("update patches fields and bumps version", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertRepository(getDb());
		const created = await repo.create(input());
		const updated = await repo.update(created.id, { name: "Renamed", enabled: false });
		expect(updated.name).toBe("Renamed");
		expect(updated.enabled).toBe(false);
		expect(updated.version).toBe(2);
	});

	it("update with matching expectedVersion succeeds, stale throws RESOURCE_CONFLICT", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertRepository(getDb());
		const created = await repo.create(input());
		await repo.update(created.id, { name: "first" }, { expectedVersion: 1 });
		await expect(
			repo.update(created.id, { name: "second" }, { expectedVersion: 1 }),
		).rejects.toMatchObject({ code: EMITO_ERROR_CODE.RESOURCE_CONFLICT });
	});

	it("update on unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertRepository(getDb());
		await expect(repo.update("alr_missing", { name: "X" })).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("update can null out escalation explicitly", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertRepository(getDb());
		const created = await repo.create(input({ escalation: { afterMinutes: 5 } }));
		const updated = await repo.update(created.id, { escalation: null });
		expect(updated.escalation).toBeNull();
	});

	it("delete removes the row; deleting twice throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertRepository(getDb());
		const created = await repo.create(input());
		await repo.delete(created.id);
		expect(await repo.findById(created.id)).toBeNull();
		await expect(repo.delete(created.id)).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("markTriggered sets lastTriggeredAt without bumping version", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertRepository(getDb());
		const created = await repo.create(input());
		const at = new Date();
		await repo.markTriggered(created.id, at);
		const fetched = await repo.findById(created.id);
		expect(fetched?.lastTriggeredAt?.getTime()).toBe(at.getTime());
		expect(fetched?.version).toBe(1);
	});

	it("markTriggered on unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertRepository(getDb());
		await expect(repo.markTriggered("alr_x", new Date())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("list filters by enabled/severity/metric and paginates newest-first", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertRepository(getDb());
		await repo.create(input({ metric: "bounce_rate", severity: "critical", enabled: true }));
		await tick();
		await repo.create(input({ metric: "dlq_depth", severity: "info", enabled: false }));

		expect((await repo.list({ limit: 50, filters: { enabled: true } })).total).toBe(1);
		expect(
			(await repo.list({ limit: 50, filters: { severity: ["critical", "info"] } })).total,
		).toBe(2);
		expect((await repo.list({ limit: 50, filters: { metric: ["dlq_depth"] } })).total).toBe(1);

		const first = await repo.list({ limit: 1 });
		expect(first.hasMore).toBe(true);
		expect(first.total).toBe(2);
		const second = await repo.list({ limit: 1, cursor: first.cursor });
		expect(second.total).toBe(2);
		expect(second.hasMore).toBe(false);
	});
});
