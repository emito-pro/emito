import { EMITO_ERROR_CODE } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAlertHistoryRepository } from "../../src/index";

describe("InMemoryAlertHistoryRepository", () => {
	let repo: InMemoryAlertHistoryRepository;

	beforeEach(() => {
		repo = new InMemoryAlertHistoryRepository();
	});

	it("create defaults triggeredAt to now and leaves resolution fields null", async () => {
		const record = await repo.create({ alertId: "alr_1" });
		expect(record.id).toMatch(/^ahi_mem_/);
		expect(record.triggeredAt).toBeInstanceOf(Date);
		expect(record.resolvedAt).toBeNull();
		expect(record.acknowledgedAt).toBeNull();
		expect(record.acknowledgedByUserId).toBeNull();
		expect(record.notes).toBeNull();
		expect(record.triggeredValue).toBeNull();
	});

	it("create stores explicit triggeredAt and triggeredValue", async () => {
		const at = new Date("2026-01-01T00:00:00Z");
		const record = await repo.create({ alertId: "alr_1", triggeredAt: at, triggeredValue: 0.42 });
		expect(record.triggeredAt).toEqual(at);
		expect(record.triggeredValue).toBe(0.42);
	});

	it("acknowledge stamps user + notes", async () => {
		const created = await repo.create({ alertId: "alr_1" });
		const acked = await repo.acknowledge(created.id, "user_op", "looking into it");
		expect(acked.acknowledgedByUserId).toBe("user_op");
		expect(acked.notes).toBe("looking into it");
		expect(acked.acknowledgedAt).toBeInstanceOf(Date);
	});

	it("acknowledge without notes leaves notes null", async () => {
		const created = await repo.create({ alertId: "alr_1" });
		const acked = await repo.acknowledge(created.id, "user_op");
		expect(acked.notes).toBeNull();
	});

	it("acknowledge on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.acknowledge("ahi_x", "u")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("resolve stamps resolvedAt and removes the firing from activeAlerts", async () => {
		const created = await repo.create({ alertId: "alr_1" });
		expect(await repo.activeAlerts()).toHaveLength(1);
		const at = new Date();
		const resolved = await repo.resolve(created.id, at);
		expect(resolved.resolvedAt).toEqual(at);
		expect(await repo.activeAlerts()).toHaveLength(0);
	});

	it("resolve on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.resolve("ahi_x", new Date())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("list filters by alertId, acknowledged, and time bounds", async () => {
		const a = await repo.create({ alertId: "alr_a" });
		await repo.create({ alertId: "alr_b" });
		await repo.acknowledge(a.id, "u");

		expect((await repo.list({ limit: 50, filters: { alertId: "alr_a" } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { acknowledged: true } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { acknowledged: false } })).total).toBe(1);

		const future = new Date(Date.now() + 60_000);
		expect((await repo.list({ limit: 50, filters: { from: future } })).total).toBe(0);
		expect((await repo.list({ limit: 50, filters: { to: future } })).total).toBe(2);
	});

	it("list paginates newest-first with accurate total", async () => {
		for (let i = 0; i < 3; i++) {
			await repo.create({ alertId: "alr_1" });
			await new Promise((r) => setTimeout(r, 2));
		}
		const first = await repo.list({ limit: 2 });
		expect(first.total).toBe(3);
		expect(first.hasMore).toBe(true);
		const second = await repo.list({ limit: 2, cursor: first.cursor });
		expect(second.hasMore).toBe(false);
		expect(second.items).toHaveLength(1);
	});

	it("findById returns record or null", async () => {
		const created = await repo.create({ alertId: "alr_1" });
		expect(await repo.findById(created.id)).toEqual(created);
		expect(await repo.findById("ahi_x")).toBeNull();
	});
});
