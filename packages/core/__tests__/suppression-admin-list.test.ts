/**
 * Unit tests for {@link InMemorySuppressionRepository.listForAdmin}.
 *
 * Mirrors the Suppression Management admin grid contract against the
 * in-memory implementation: the paged `ApiPage` envelope, the rich filter facets
 * (address search, multi-value channel/reason/provider, `addedAt` bounds),
 * active-only-by-default, and keyset cursor pagination. Keeping the in-memory
 * impl honest here means the contract suite (which boots the in-memory repos) and
 * the Drizzle integration tests agree on the same paging boundary.
 */
import { describe, expect, it } from "vitest";
import { InMemorySuppressionRepository } from "../src/repositories/in-memory/index";

async function seed(repo: InMemorySuppressionRepository): Promise<void> {
	await repo.create({
		address: "alice@b.com",
		channel: "email",
		reason: "hard_bounce",
		provider: "resend",
	});
	await repo.create({
		address: "bob@b.com",
		channel: "sms",
		reason: "complaint",
		provider: "twilio",
	});
	await repo.create({ address: "carol@b.com", channel: "push", reason: "manual" });
}

describe("InMemorySuppressionRepository.listForAdmin", () => {
	it("returns a paged ApiPage envelope, newest-first", async () => {
		const repo = new InMemorySuppressionRepository();
		await seed(repo);
		const page = await repo.listForAdmin();
		expect(page.total).toBe(3);
		expect(page.hasMore).toBe(false);
		expect(page.cursor).toBeNull();
		expect(page.items.map((r) => r.address)).toEqual(["carol@b.com", "bob@b.com", "alice@b.com"]);
	});

	it("excludes archived rows unless includeArchived", async () => {
		const repo = new InMemorySuppressionRepository();
		await seed(repo);
		await repo.archive("bob@b.com", "sms");
		expect((await repo.listForAdmin()).total).toBe(2);
		expect((await repo.listForAdmin({ includeArchived: true })).total).toBe(3);
	});

	it("filters by multi-value channel/reason/provider facets", async () => {
		const repo = new InMemorySuppressionRepository();
		await seed(repo);
		expect((await repo.listForAdmin({ channels: ["email", "push"] })).total).toBe(2);
		expect((await repo.listForAdmin({ reasons: ["complaint"] })).total).toBe(1);
		expect((await repo.listForAdmin({ providers: ["resend"] })).total).toBe(1);
	});

	it("free-text searches the address case-insensitively", async () => {
		const repo = new InMemorySuppressionRepository();
		await seed(repo);
		const result = await repo.listForAdmin({ addressSearch: "ALICE" });
		expect(result.total).toBe(1);
		expect(result.items[0]?.address).toBe("alice@b.com");
	});

	it("bounds the result by an inclusive addedAt range", async () => {
		const repo = new InMemorySuppressionRepository();
		await seed(repo);
		const future = new Date(Date.now() + 60_000);
		const past = new Date(Date.now() - 60_000);
		expect((await repo.listForAdmin({ addedFrom: future })).total).toBe(0);
		expect((await repo.listForAdmin({ addedTo: future })).total).toBe(3);
		expect((await repo.listForAdmin({ addedFrom: past })).total).toBe(3);
	});

	it("keyset-paginates across pages with no overlap", async () => {
		const repo = new InMemorySuppressionRepository();
		await seed(repo);
		const page1 = await repo.listForAdmin({ limit: 2 });
		expect(page1.items).toHaveLength(2);
		expect(page1.hasMore).toBe(true);
		expect(page1.cursor).not.toBeNull();
		expect(page1.total).toBe(3);

		const page2 = await repo.listForAdmin({ limit: 2, cursor: page1.cursor ?? undefined });
		expect(page2.items).toHaveLength(1);
		expect(page2.hasMore).toBe(false);
		const ids = new Set([...page1.items, ...page2.items].map((r) => r.id));
		expect(ids.size).toBe(3);
	});
});
