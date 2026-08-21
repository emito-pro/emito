import { EMITO_ERROR_CODE } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminBroadcastCreate } from "../../src/index";
import { InMemoryBroadcastRepository } from "../../src/index";

function input(overrides: Partial<AdminBroadcastCreate> = {}): AdminBroadcastCreate {
	return {
		title: "Spring sale",
		listId: "lst_1",
		eventKey: "promo.spring",
		createdByUserId: "user_1",
		...overrides,
	};
}

describe("InMemoryBroadcastRepository", () => {
	let repo: InMemoryBroadcastRepository;

	beforeEach(() => {
		repo = new InMemoryBroadcastRepository();
	});

	it("create starts scheduled with zeroed counters", async () => {
		const record = await repo.create(input());
		expect(record.id).toMatch(/^brc_mem_/);
		expect(record.status).toBe("scheduled");
		expect(record.sentCount).toBe(0);
		expect(record.deliveredCount).toBe(0);
		expect(record.totalRecipients).toBe(0);
		expect(record.scheduledFor).toBeNull();
	});

	it("create honours totalRecipients and scheduledFor", async () => {
		const when = new Date("2026-07-01T00:00:00Z");
		const record = await repo.create(input({ totalRecipients: 100, scheduledFor: when }));
		expect(record.totalRecipients).toBe(100);
		expect(record.scheduledFor).toEqual(when);
	});

	it("incrementCounters applies signed deltas and clamps at zero", async () => {
		const created = await repo.create(input());
		await repo.incrementCounters(created.id, { sentCount: 5, deliveredCount: 3 });
		let fetched = await repo.findById(created.id);
		expect(fetched?.sentCount).toBe(5);
		expect(fetched?.deliveredCount).toBe(3);

		await repo.incrementCounters(created.id, { sentCount: -2 });
		fetched = await repo.findById(created.id);
		expect(fetched?.sentCount).toBe(3);

		await repo.incrementCounters(created.id, { sentCount: -100 });
		fetched = await repo.findById(created.id);
		expect(fetched?.sentCount).toBe(0);
	});

	it("incrementCounters ignores undefined keys", async () => {
		const created = await repo.create(input());
		await repo.incrementCounters(created.id, { openedCount: 1 });
		const fetched = await repo.findById(created.id);
		expect(fetched?.openedCount).toBe(1);
		expect(fetched?.clickedCount).toBe(0);
	});

	it("incrementCounters on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.incrementCounters("brc_x", { sentCount: 1 })).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("cancel transitions non-terminal -> cancelled", async () => {
		const created = await repo.create(input());
		const cancelled = await repo.cancel(created.id, "user_2");
		expect(cancelled.status).toBe("cancelled");
	});

	it("cancel on a terminal broadcast throws RESOURCE_CONFLICT", async () => {
		const created = await repo.create(input({ status: "sent" }));
		await expect(repo.cancel(created.id, "user_2")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("cancel on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.cancel("brc_x", "user_2")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("list filters by listId, status[], and time bounds", async () => {
		await repo.create(input({ listId: "lst_a", status: "scheduled" }));
		await repo.create(input({ listId: "lst_b", status: "sent" }));

		expect((await repo.list({ limit: 50, filters: { listId: "lst_a" } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { status: ["sent"] } })).total).toBe(1);
		expect(
			(await repo.list({ limit: 50, filters: { from: new Date("2000-01-01T00:00:00Z") } })).total,
		).toBe(2);
	});

	it("list paginates newest-first with accurate total", async () => {
		for (let i = 0; i < 3; i++) {
			await repo.create(input());
			await new Promise((r) => setTimeout(r, 2));
		}
		const first = await repo.list({ limit: 2 });
		expect(first.total).toBe(3);
		expect(first.hasMore).toBe(true);
		const second = await repo.list({ limit: 2, cursor: first.cursor });
		expect(second.items).toHaveLength(1);
	});

	it("findById returns record or null", async () => {
		const created = await repo.create(input());
		expect(await repo.findById(created.id)).toEqual(created);
		expect(await repo.findById("brc_x")).toBeNull();
	});
});
