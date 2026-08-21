/**
 * Integration tests for {@link DrizzleScheduledSendRepository} against a real PostgreSQL.
 * Covers create defaults, cancel/reschedule lifecycle guards, dueBy scheduler poll, filters.
 */
import type { ScheduledSendCreate } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { DrizzleScheduledSendRepository } from "../../src/repositories/drizzle-scheduled-send-repository";
import { dbAvailable, getDb, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

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

describe("DrizzleScheduledSendRepository", () => {
	it("create starts pending with empty payload/recipients and null cancellation fields", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleScheduledSendRepository(getDb());
		const record = await repo.create(input());
		expect(record.id).toMatch(/^sch_/);
		expect(record.status).toBe("pending");
		expect(record.payload).toEqual({});
		expect(record.cancelledAt).toBeNull();
	});

	it("cancel transitions pending -> cancelled; terminal cancel throws RESOURCE_CONFLICT", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleScheduledSendRepository(getDb());
		const created = await repo.create(input());
		const cancelled = await repo.cancel(created.id, "user_2");
		expect(cancelled.status).toBe("cancelled");
		expect(cancelled.cancelledByUserId).toBe("user_2");
		await expect(repo.cancel(created.id, "user_2")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("cancel on unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleScheduledSendRepository(getDb());
		await expect(repo.cancel("sch_x", "user_2")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("reschedule moves a pending job; non-pending reschedule throws RESOURCE_CONFLICT", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleScheduledSendRepository(getDb());
		const created = await repo.create(input());
		const when = new Date("2026-08-01T12:00:00Z");
		const rescheduled = await repo.reschedule(created.id, when, "UTC");
		expect(rescheduled.scheduledFor.getTime()).toBe(when.getTime());
		expect(rescheduled.timezone).toBe("UTC");

		await repo.cancel(created.id, "user_2");
		await expect(repo.reschedule(created.id, new Date(), "UTC")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("reschedule on unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleScheduledSendRepository(getDb());
		await expect(repo.reschedule("sch_x", new Date(), "UTC")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("dueBy returns pending jobs at/before the cutoff oldest-first, capped, excluding cancelled", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleScheduledSendRepository(getDb());
		const past = await repo.create(input({ scheduledFor: new Date("2026-01-01T00:00:00Z") }));
		await repo.create(input({ scheduledFor: new Date("2026-02-01T00:00:00Z") }));
		await repo.create(input({ scheduledFor: new Date("2030-01-01T00:00:00Z") }));
		const cancelled = await repo.create(input({ scheduledFor: new Date("2025-01-01T00:00:00Z") }));
		await repo.cancel(cancelled.id, "user_2");

		const due = await repo.dueBy(new Date("2026-06-01T00:00:00Z"), 10);
		expect(due).toHaveLength(2);
		expect(due[0]?.id).toBe(past.id);

		const capped = await repo.dueBy(new Date("2026-06-01T00:00:00Z"), 1);
		expect(capped).toHaveLength(1);
	});

	it("list filters by status[] and time bounds, paginates newest-first", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleScheduledSendRepository(getDb());
		const a = await repo.create(input({ scheduledFor: new Date("2026-01-01T00:00:00Z") }));
		await tick();
		await repo.create(input({ scheduledFor: new Date("2026-12-01T00:00:00Z") }));
		await repo.cancel(a.id, "user_2");

		expect((await repo.list({ limit: 50, filters: { status: ["cancelled"] } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { status: ["pending"] } })).total).toBe(1);
		expect(
			(await repo.list({ limit: 50, filters: { from: new Date("2026-06-01T00:00:00Z") } })).total,
		).toBe(1);

		const first = await repo.list({ limit: 1 });
		expect(first.hasMore).toBe(true);
		expect(first.total).toBe(2);
	});
});
