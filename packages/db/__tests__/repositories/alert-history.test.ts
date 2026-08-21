/**
 * Integration tests for {@link DrizzleAlertHistoryRepository} against a real PostgreSQL.
 * Covers create (numeric triggeredValue round-trip), acknowledge, resolve, activeAlerts, filters.
 */
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { DrizzleAlertHistoryRepository } from "../../src/repositories/drizzle-alert-history-repository";
import { dbAvailable, getDb, seedAlert, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

describe("DrizzleAlertHistoryRepository", () => {
	it("create round-trips numeric triggeredValue and leaves resolution fields null", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertHistoryRepository(getDb());
		const alertId = await seedAlert("hist-create");
		const record = await repo.create({ alertId, triggeredValue: 0.4275 });
		expect(record.id).toMatch(/^ahi_/);
		expect(record.triggeredValue).toBeCloseTo(0.4275);
		expect(record.resolvedAt).toBeNull();
		expect(record.acknowledgedAt).toBeNull();

		const fetched = await repo.findById(record.id);
		expect(fetched?.triggeredValue).toBeCloseTo(0.4275);
	});

	it("create with no triggeredValue stores null", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertHistoryRepository(getDb());
		const alertId = await seedAlert("hist-null");
		const record = await repo.create({ alertId });
		expect(record.triggeredValue).toBeNull();
	});

	it("acknowledge stamps user + notes", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertHistoryRepository(getDb());
		const alertId = await seedAlert("hist-ack");
		const created = await repo.create({ alertId });
		const acked = await repo.acknowledge(created.id, "user_op", "investigating");
		expect(acked.acknowledgedByUserId).toBe("user_op");
		expect(acked.notes).toBe("investigating");
		expect(acked.acknowledgedAt).toBeInstanceOf(Date);
	});

	it("acknowledge on unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertHistoryRepository(getDb());
		await expect(repo.acknowledge("ahi_x", "u")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("resolve removes the firing from activeAlerts", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertHistoryRepository(getDb());
		const alertId = await seedAlert("hist-resolve");
		const created = await repo.create({ alertId });
		expect(await repo.activeAlerts()).toHaveLength(1);
		await repo.resolve(created.id, new Date());
		expect(await repo.activeAlerts()).toHaveLength(0);
	});

	it("resolve on unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertHistoryRepository(getDb());
		await expect(repo.resolve("ahi_x", new Date())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("list filters by alertId and acknowledged, paginates newest-first", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleAlertHistoryRepository(getDb());
		const alertA = await seedAlert("hist-list-a");
		const alertB = await seedAlert("hist-list-b");
		const a = await repo.create({ alertId: alertA });
		await tick();
		await repo.create({ alertId: alertB });
		await repo.acknowledge(a.id, "u");

		expect((await repo.list({ limit: 50, filters: { alertId: alertA } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { acknowledged: true } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { acknowledged: false } })).total).toBe(1);

		const first = await repo.list({ limit: 1 });
		expect(first.hasMore).toBe(true);
		expect(first.total).toBe(2);
	});
});
