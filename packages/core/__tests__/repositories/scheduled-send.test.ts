import { EMITO_ERROR_CODE } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { ScheduledSendCreate } from "../../src/index";
import { InMemoryScheduledSendRepository } from "../../src/index";

function input(overrides: Partial<ScheduledSendCreate> = {}): ScheduledSendCreate {
	return {
		kind: "broadcast",
		eventKey: "newsletter.weekly",
		scheduledFor: new Date("2026-07-01T09:00:00Z"),
		timezone: "Europe/Warsaw",
		createdByUserId: "user_1",
		...overrides,
	};
}

describe("InMemoryScheduledSendRepository", () => {
	let repo: InMemoryScheduledSendRepository;

	beforeEach(() => {
		repo = new InMemoryScheduledSendRepository();
	});

	it("create starts pending with empty payload/recipients and null cancellation fields", async () => {
		const record = await repo.create(input());
		expect(record.id).toMatch(/^sch_mem_/);
		expect(record.status).toBe("pending");
		expect(record.payload).toEqual({});
		expect(record.recipients).toEqual({});
		expect(record.cancelledAt).toBeNull();
		expect(record.cancelledByUserId).toBeNull();
	});

	it("cancel transitions pending -> cancelled and stamps the actor", async () => {
		const created = await repo.create(input());
		const cancelled = await repo.cancel(created.id, "user_2");
		expect(cancelled.status).toBe("cancelled");
		expect(cancelled.cancelledByUserId).toBe("user_2");
		expect(cancelled.cancelledAt).toBeInstanceOf(Date);
	});

	it("cancel on a terminal job throws RESOURCE_CONFLICT", async () => {
		const created = await repo.create(input());
		await repo.cancel(created.id, "user_2");
		await expect(repo.cancel(created.id, "user_2")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("cancel on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.cancel("sch_x", "user_2")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("reschedule moves a pending job to a new time/timezone", async () => {
		const created = await repo.create(input());
		const when = new Date("2026-08-01T12:00:00Z");
		const rescheduled = await repo.reschedule(created.id, when, "UTC");
		expect(rescheduled.scheduledFor).toEqual(when);
		expect(rescheduled.timezone).toBe("UTC");
	});

	it("reschedule of a non-pending job throws RESOURCE_CONFLICT", async () => {
		const created = await repo.create(input());
		await repo.cancel(created.id, "user_2");
		await expect(repo.reschedule(created.id, new Date(), "UTC")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("reschedule on unknown id throws RESOURCE_NOT_FOUND", async () => {
		await expect(repo.reschedule("sch_x", new Date(), "UTC")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("dueBy returns pending jobs at/before the cutoff, oldest-first, capped at limit", async () => {
		const past = await repo.create(input({ scheduledFor: new Date("2026-01-01T00:00:00Z") }));
		await repo.create(input({ scheduledFor: new Date("2026-02-01T00:00:00Z") }));
		await repo.create(input({ scheduledFor: new Date("2030-01-01T00:00:00Z") }));

		const due = await repo.dueBy(new Date("2026-06-01T00:00:00Z"), 10);
		expect(due).toHaveLength(2);
		expect(due[0].id).toBe(past.id);

		const capped = await repo.dueBy(new Date("2026-06-01T00:00:00Z"), 1);
		expect(capped).toHaveLength(1);
	});

	it("dueBy excludes cancelled jobs", async () => {
		const created = await repo.create(input({ scheduledFor: new Date("2026-01-01T00:00:00Z") }));
		await repo.cancel(created.id, "user_2");
		expect(await repo.dueBy(new Date("2026-06-01T00:00:00Z"), 10)).toHaveLength(0);
	});

	it("list filters by status[] and time bounds", async () => {
		const a = await repo.create(input({ scheduledFor: new Date("2026-01-01T00:00:00Z") }));
		await repo.create(input({ scheduledFor: new Date("2026-12-01T00:00:00Z") }));
		await repo.cancel(a.id, "user_2");

		expect((await repo.list({ limit: 50, filters: { status: ["cancelled"] } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { status: ["pending"] } })).total).toBe(1);
		expect(
			(await repo.list({ limit: 50, filters: { from: new Date("2026-06-01T00:00:00Z") } })).total,
		).toBe(1);
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
		expect(await repo.findById("sch_x")).toBeNull();
	});
});
