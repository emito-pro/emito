import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { AlertCreate } from "../../src/index";
import { InMemoryAlertRepository } from "../../src/index";

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

describe("InMemoryAlertRepository", () => {
	let repo: InMemoryAlertRepository;

	beforeEach(() => {
		repo = new InMemoryAlertRepository();
	});

	it("create defaults enabled=true and version=1, escalation/maintenance null", async () => {
		const record = await repo.create(input());
		expect(record.id).toMatch(/^alr_mem_/);
		expect(record.enabled).toBe(true);
		expect(record.version).toBe(1);
		expect(record.escalation).toBeNull();
		expect(record.maintenance).toBeNull();
		expect(record.lastTriggeredAt).toBeNull();
	});

	it("create respects explicit enabled=false and nested config", async () => {
		const record = await repo.create(
			input({ enabled: false, escalation: { afterMinutes: 30 }, maintenance: { cron: "* * *" } }),
		);
		expect(record.enabled).toBe(false);
		expect(record.escalation).toEqual({ afterMinutes: 30 });
	});

	it("findById returns record or null", async () => {
		const created = await repo.create(input());
		expect(await repo.findById(created.id)).toEqual(created);
		expect(await repo.findById("alr_x")).toBeNull();
	});

	it("update patches fields and bumps version", async () => {
		const created = await repo.create(input());
		const updated = await repo.update(created.id, { name: "Renamed", enabled: false });
		expect(updated.name).toBe("Renamed");
		expect(updated.enabled).toBe(false);
		expect(updated.version).toBe(2);
		expect(updated.metric).toBe(created.metric);
	});

	it("update can null out escalation/maintenance explicitly", async () => {
		const created = await repo.create(input({ escalation: { afterMinutes: 5 } }));
		const updated = await repo.update(created.id, { escalation: null });
		expect(updated.escalation).toBeNull();
	});

	it("update with matching expectedVersion succeeds", async () => {
		const created = await repo.create(input());
		const updated = await repo.update(created.id, { name: "X" }, { expectedVersion: 1 });
		expect(updated.version).toBe(2);
	});

	it("update with stale expectedVersion throws RESOURCE_CONFLICT", async () => {
		const created = await repo.create(input());
		await repo.update(created.id, { name: "first" });
		await expect(
			repo.update(created.id, { name: "second" }, { expectedVersion: 1 }),
		).rejects.toMatchObject({ code: EMITO_ERROR_CODE.RESOURCE_CONFLICT });
	});

	it("update on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.update("alr_missing", { name: "X" })).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("delete removes the record; deleting twice throws RESOURCE_NOT_FOUND", async () => {
		const created = await repo.create(input());
		await repo.delete(created.id);
		expect(await repo.findById(created.id)).toBeNull();
		await expect(repo.delete(created.id)).rejects.toBeInstanceOf(EmitoError);
	});

	it("markTriggered sets lastTriggeredAt without bumping version", async () => {
		const created = await repo.create(input());
		const at = new Date();
		await repo.markTriggered(created.id, at);
		const fetched = await repo.findById(created.id);
		expect(fetched?.lastTriggeredAt).toEqual(at);
		expect(fetched?.version).toBe(1);
	});

	it("markTriggered on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.markTriggered("alr_x", new Date())).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("list filters by enabled, severity[], and metric[]", async () => {
		await repo.create(input({ metric: "bounce_rate", severity: "critical", enabled: true }));
		await repo.create(input({ metric: "dlq_depth", severity: "info", enabled: false }));

		expect((await repo.list({ limit: 50, filters: { enabled: true } })).total).toBe(1);
		expect(
			(await repo.list({ limit: 50, filters: { severity: ["critical", "info"] } })).total,
		).toBe(2);
		expect((await repo.list({ limit: 50, filters: { metric: ["dlq_depth"] } })).total).toBe(1);
		// Empty arrays are treated as no-filter.
		expect((await repo.list({ limit: 50, filters: { severity: [], metric: [] } })).total).toBe(2);
	});

	it("list paginates newest-first with accurate total", async () => {
		for (let i = 0; i < 3; i++) {
			await repo.create(input({ name: `a${i}` }));
			await new Promise((r) => setTimeout(r, 2));
		}
		const first = await repo.list({ limit: 2 });
		expect(first.total).toBe(3);
		expect(first.hasMore).toBe(true);
		const second = await repo.list({ limit: 2, cursor: first.cursor });
		expect(second.items).toHaveLength(1);
		expect(second.hasMore).toBe(false);
	});
});
