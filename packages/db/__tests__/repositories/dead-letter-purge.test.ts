/**
 * Integration tests for {@link DrizzleDeadLetterRepository.purgeResolved} against
 * a real PostgreSQL.
 *
 * `purgeResolved` backs the danger-zone "purge DLQ" operation: it deletes
 * every *resolved* dead-letter row and returns the deleted count, leaving the
 * unresolved entries untouched. These tests assert that selectivity, the returned
 * count, and the idempotent no-op on a queue with nothing resolved.
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

describe("DrizzleDeadLetterRepository.purgeResolved", () => {
	it("deletes only resolved rows and returns the deleted count", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleDeadLetterRepository(getDb());
		const a = await repo.create(input(1));
		const b = await repo.create(input(2));
		await repo.create(input(3)); // left unresolved
		await repo.resolve(a.id, "retried");
		await repo.resolve(b.id, "discarded: junk");

		const purged = await repo.purgeResolved();
		expect(purged).toBe(2);

		// The two resolved rows are gone; the unresolved one survives.
		expect(await repo.findById(a.id)).toBeNull();
		expect(await repo.findById(b.id)).toBeNull();
		const unresolved = await repo.list({ resolved: false });
		expect(unresolved.items).toHaveLength(1);
	});

	it("is a no-op (returns 0) when nothing is resolved", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleDeadLetterRepository(getDb());
		await repo.create(input(4));
		await repo.create(input(5));
		expect(await repo.purgeResolved()).toBe(0);
		const all = await repo.list({ resolved: true });
		expect(all.items).toHaveLength(2);
	});

	it("returns 0 on an empty queue", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleDeadLetterRepository(getDb());
		expect(await repo.purgeResolved()).toBe(0);
	});
});
