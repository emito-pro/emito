/**
 * Integration tests for {@link DrizzleSuppressionRepository.listForAdmin} against
 * a real PostgreSQL.
 *
 * Covers the Suppression Management admin grid query: the paged envelope
 * (`{ items, hasMore, cursor, total }`), the rich filter facets (address search,
 * multi-channel/reason/provider, `addedAt` date bounds), active-only-by-default,
 * and keyset cursor pagination across pages. Gates on the injected `DB_URI` and
 * is a no-op when Docker is unavailable.
 */
import type { CreateSuppressionData } from "@emito/core";
import { describe, expect, it } from "vitest";
import { DrizzleSuppressionRepository } from "../../src/repositories/drizzle-suppression-repository";
import { dbAvailable, getDb, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

function row(overrides: Partial<CreateSuppressionData> = {}): CreateSuppressionData {
	return {
		address: "a@b.com",
		channel: "email",
		reason: "hard_bounce",
		...overrides,
	};
}

describe("DrizzleSuppressionRepository.listForAdmin", () => {
	it("returns a paged envelope with total and newest-first ordering", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSuppressionRepository(getDb());
		await repo.create(row({ address: "first@b.com" }));
		await tick();
		await repo.create(row({ address: "second@b.com" }));

		const page = await repo.listForAdmin();
		expect(page.total).toBe(2);
		expect(page.hasMore).toBe(false);
		expect(page.cursor).toBeNull();
		expect(page.items).toHaveLength(2);
		// Newest-first: second created comes first.
		expect(page.items[0]?.address).toBe("second@b.com");
	});

	it("excludes archived rows unless includeArchived is set", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSuppressionRepository(getDb());
		await repo.create(row({ address: "active@b.com" }));
		await repo.create(row({ address: "gone@b.com", channel: "sms" }));
		await repo.archive("gone@b.com", "sms");

		const activeOnly = await repo.listForAdmin();
		expect(activeOnly.total).toBe(1);
		expect(activeOnly.items[0]?.address).toBe("active@b.com");

		const all = await repo.listForAdmin({ includeArchived: true });
		expect(all.total).toBe(2);
	});

	it("filters by multi-value channel, reason, and provider facets", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSuppressionRepository(getDb());
		await repo.create(
			row({ address: "e@b.com", channel: "email", reason: "hard_bounce", provider: "resend" }),
		);
		await repo.create(
			row({ address: "s@b.com", channel: "sms", reason: "complaint", provider: "twilio" }),
		);
		await repo.create(row({ address: "p@b.com", channel: "push", reason: "manual" }));

		const byChannel = await repo.listForAdmin({ channels: ["email", "sms"] });
		expect(byChannel.total).toBe(2);

		const byReason = await repo.listForAdmin({ reasons: ["complaint"] });
		expect(byReason.total).toBe(1);
		expect(byReason.items[0]?.address).toBe("s@b.com");

		const byProvider = await repo.listForAdmin({ providers: ["resend"] });
		expect(byProvider.total).toBe(1);
		expect(byProvider.items[0]?.address).toBe("e@b.com");
	});

	it("free-text searches the address case-insensitively and escapes LIKE metachars", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSuppressionRepository(getDb());
		await repo.create(row({ address: "Alice@example.com" }));
		await repo.create(row({ address: "bob_50%@example.com", channel: "sms" }));

		const byCase = await repo.listForAdmin({ addressSearch: "alice" });
		expect(byCase.total).toBe(1);
		expect(byCase.items[0]?.address).toBe("Alice@example.com");

		// `%` and `_` in the term must match literally, not as wildcards.
		const literal = await repo.listForAdmin({ addressSearch: "50%" });
		expect(literal.total).toBe(1);
		expect(literal.items[0]?.address).toBe("bob_50%@example.com");
	});

	it("bounds the result by an inclusive addedAt range", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSuppressionRepository(getDb());
		const before = new Date(Date.now() - 60_000);
		await repo.create(row({ address: "in-range@b.com" }));
		const future = new Date(Date.now() + 60_000);

		expect((await repo.listForAdmin({ addedFrom: before })).total).toBe(1);
		expect((await repo.listForAdmin({ addedFrom: future })).total).toBe(0);
		expect((await repo.listForAdmin({ addedTo: before })).total).toBe(0);
		expect((await repo.listForAdmin({ addedTo: future })).total).toBe(1);
	});

	it("keyset-paginates: page 1 yields a cursor, page 2 returns the remainder", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSuppressionRepository(getDb());
		for (let i = 0; i < 3; i += 1) {
			await repo.create(row({ address: `u${i}@b.com` }));
			await tick();
		}

		const page1 = await repo.listForAdmin({ limit: 2 });
		expect(page1.items).toHaveLength(2);
		expect(page1.hasMore).toBe(true);
		expect(page1.cursor).not.toBeNull();
		expect(page1.total).toBe(3);

		const page2 = await repo.listForAdmin({ limit: 2, cursor: page1.cursor ?? undefined });
		expect(page2.items).toHaveLength(1);
		expect(page2.hasMore).toBe(false);
		expect(page2.cursor).toBeNull();
		// No overlap between the two pages.
		const ids = new Set([...page1.items, ...page2.items].map((r) => r.id));
		expect(ids.size).toBe(3);
	});
});
