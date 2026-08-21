/**
 * Integration tests for {@link DrizzleDeadLetterRepository.findAllForAdmin} against
 * a real PostgreSQL.
 *
 * `findAllForAdmin` backs the admin DLQ list (`GET /admin/dead-letters`):
 * it loads every dead-letter row — resolved and unresolved alike — newest-first by
 * `exhaustedAt`, so the endpoint can project + classify + filter + cursor-paginate
 * in memory (the auto-classified `rootCause` is derived from the attempt chain, not
 * a stored column, so it cannot be a SQL filter). These tests assert the inclusion
 * of both states, the newest-first ordering, the empty-queue case, and that the
 * stored attempts round-trip with `Date` timestamps.
 */
import type { CreateDeadLetterData } from "@emito/core";
import { describe, expect, it } from "vitest";
import { DrizzleDeadLetterRepository } from "../../src/repositories/drizzle-dead-letter-repository";
import { dbAvailable, getDb, setupAdminTestDb } from "./admin-test-db";

setupAdminTestDb();

function input(idx: number): CreateDeadLetterData {
	return {
		notificationId: `ntf_${idx}`,
		subscriberId: `sub_${idx}`,
		eventType: "order.shipped",
		channel: "email",
		attempts: [
			{
				provider: "smtp",
				timestamp: new Date("2026-06-02T10:00:00.000Z"),
				errorCode: "550",
				errorMessage: "mailbox unavailable",
			},
		],
		payload: { category: "transactional" },
	};
}

describe("DrizzleDeadLetterRepository.findAllForAdmin", () => {
	it("returns both resolved and unresolved rows", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleDeadLetterRepository(getDb());
		const a = await repo.create(input(1));
		const b = await repo.create(input(2));
		const c = await repo.create(input(3)); // left unresolved
		await repo.resolve(a.id, "retried");
		await repo.resolve(b.id, "discarded: junk");

		const all = await repo.findAllForAdmin();
		expect(all).toHaveLength(3);
		expect(new Set(all.map((r) => r.id))).toEqual(new Set([a.id, b.id, c.id]));
		// The resolved rows carry their resolution; the unresolved one does not.
		const resolved = all.filter((r) => r.resolvedAt != null);
		expect(resolved).toHaveLength(2);
	});

	it("orders rows newest-first by exhaustedAt", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleDeadLetterRepository(getDb());
		const first = await repo.create(input(10));
		const second = await repo.create(input(11));
		const third = await repo.create(input(12));
		const all = await repo.findAllForAdmin();
		const ids = all.map((r) => r.id);
		// Insert order ascending by exhaustedAt (defaultNow); newest-first reverses it.
		expect(ids).toEqual([third.id, second.id, first.id]);
	});

	it("round-trips the attempt chain with Date timestamps", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleDeadLetterRepository(getDb());
		await repo.create(input(20));
		const all = await repo.findAllForAdmin();
		const attempt = all[0]?.attempts[0];
		expect(attempt?.timestamp).toBeInstanceOf(Date);
		expect(attempt?.errorCode).toBe("550");
	});

	it("returns an empty array on an empty queue", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleDeadLetterRepository(getDb());
		expect(await repo.findAllForAdmin()).toEqual([]);
	});
});
