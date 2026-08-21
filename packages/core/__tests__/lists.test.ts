/**
 * Unit tests for list management, membership, and double opt-in.
 * Tests run against in-memory implementations and service classes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryListMemberRepository } from "../src/repositories/in-memory/in-memory-list-member-repository";
import { InMemoryListRepository } from "../src/repositories/in-memory/in-memory-list-repository";
import { ListMemberConfirmAdapter } from "../src/lists/confirm";
import { MembershipService } from "../src/lists/membership";
import type { ListRecord } from "../src/repositories/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeListSeed(overrides: Partial<ListRecord> = {}): ListRecord {
	return {
		id: "lst_001",
		name: "Newsletter",
		slug: "newsletter",
		optinType: "single",
		visibility: "private",
		memberCount: 0,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function makeMembershipService(
	listRepo: InMemoryListRepository,
	memberRepo: InMemoryListMemberRepository,
	options: { withEmailSender?: boolean } = {},
) {
	const confirmEmailSender = options.withEmailSender
		? {
				sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
			}
		: undefined;

	const tokenSigner = {
		sign: vi.fn().mockReturnValue("signed-token"),
	};

	const service = new MembershipService({
		listRepository: listRepo,
		listMemberRepository: memberRepo,
		tokenSigner,
		unsubscribeSecret: "test-secret-32-bytes-minimum-here!!",
		confirmEmailSender,
	});

	return { service, confirmEmailSender, tokenSigner };
}

// ---------------------------------------------------------------------------
// InMemoryListRepository — criteria 1, 2
// ---------------------------------------------------------------------------

describe("InMemoryListRepository", () => {
	let repo: InMemoryListRepository;

	beforeEach(() => {
		repo = new InMemoryListRepository();
	});

	describe("create", () => {
		it("should create a list and return it with id and defaults", async () => {
			const list = await repo.create({ name: "Newsletter", slug: "newsletter" });
			expect(list.id).toBeDefined();
			expect(list.slug).toBe("newsletter");
			expect(list.optinType).toBe("single");
			expect(list.memberCount).toBe(0);
			expect(list.archivedAt).toBeUndefined();
		});

		it("should throw on duplicate slug", async () => {
			await repo.create({ name: "A", slug: "newsletter" });
			await expect(repo.create({ name: "B", slug: "newsletter" })).rejects.toThrow();
		});

		it("should respect optinType when provided", async () => {
			const list = await repo.create({ name: "Double", slug: "double", optinType: "double" });
			expect(list.optinType).toBe("double");
		});
	});

	describe("update", () => {
		it("should update name and description", async () => {
			const list = await repo.create({ name: "Old Name", slug: "old-name" });
			const updated = await repo.update(list.id, { name: "New Name", description: "Desc" });
			expect(updated.name).toBe("New Name");
			expect(updated.description).toBe("Desc");
		});

		it("should not change slug on update", async () => {
			const list = await repo.create({ name: "Test", slug: "test-slug" });
			const updated = await repo.update(list.id, { name: "Updated" });
			expect(updated.slug).toBe("test-slug");
		});

		it("should throw when list id not found", async () => {
			await expect(repo.update("nonexistent", { name: "X" })).rejects.toThrow();
		});
	});

	describe("archive", () => {
		it("should set archivedAt on archive", async () => {
			const list = await repo.create({ name: "List", slug: "list" });
			const archived = await repo.archive(list.id);
			expect(archived.archivedAt).toBeInstanceOf(Date);
		});

		it("should throw when archiving non-existent list", async () => {
			await expect(repo.archive("ghost")).rejects.toThrow();
		});
	});

	describe("findBySlug", () => {
		it("should return list by slug", async () => {
			await repo.create({ name: "Newsletter", slug: "newsletter" });
			const found = await repo.findBySlug("newsletter");
			expect(found).not.toBeNull();
			expect(found?.slug).toBe("newsletter");
		});

		it("should return null for archived list (criteria 2)", async () => {
			const list = await repo.create({ name: "Newsletter", slug: "newsletter" });
			await repo.archive(list.id);
			const found = await repo.findBySlug("newsletter");
			expect(found).toBeNull();
		});

		it("should return null for non-existent slug", async () => {
			const found = await repo.findBySlug("ghost");
			expect(found).toBeNull();
		});
	});

	describe("list", () => {
		it("should return all lists with cursor pagination (criteria 9)", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			for (let i = 0; i < 3; i++) {
				vi.advanceTimersByTime(1000);
				await repo.create({ name: `List ${i}`, slug: `list-${i}` });
			}
			vi.useRealTimers();

			const page1 = await repo.list({ limit: 2 });
			expect(page1.items).toHaveLength(2);
			expect(page1.hasMore).toBe(true);
			expect(page1.cursor).toBeDefined();

			const page2 = await repo.list({ limit: 2, cursor: page1.cursor });
			expect(page2.items).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
		});

		it("should filter to only archived when archived=true", async () => {
			const list = await repo.create({ name: "A", slug: "a" });
			await repo.create({ name: "B", slug: "b" });
			await repo.archive(list.id);

			const result = await repo.list({ archived: true });
			expect(result.items).toHaveLength(1);
			expect(result.items[0].id).toBe(list.id);
		});

		it("should filter to only active when archived=false", async () => {
			const list = await repo.create({ name: "A", slug: "a" });
			await repo.create({ name: "B", slug: "b" });
			await repo.archive(list.id);

			const result = await repo.list({ archived: false });
			expect(result.items).toHaveLength(1);
			expect(result.items[0].slug).toBe("b");
		});
	});

	describe("updateMemberCount", () => {
		it("should increment memberCount (criteria 8)", async () => {
			const list = await repo.create({ name: "List", slug: "list" });
			await repo.updateMemberCount(list.id, 1);
			const found = await repo.findById(list.id);
			expect(found?.memberCount).toBe(1);
		});

		it("should decrement memberCount and not go below zero", async () => {
			const list = await repo.create({ name: "List", slug: "list" });
			await repo.updateMemberCount(list.id, -1);
			const found = await repo.findById(list.id);
			expect(found?.memberCount).toBe(0);
		});

		it("should accumulate deltas across calls", async () => {
			const list = await repo.create({ name: "List", slug: "list" });
			await repo.updateMemberCount(list.id, 3);
			await repo.updateMemberCount(list.id, -1);
			const found = await repo.findById(list.id);
			expect(found?.memberCount).toBe(2);
		});
	});
});

// ---------------------------------------------------------------------------
// InMemoryListMemberRepository — direct method tests
// ---------------------------------------------------------------------------

describe("InMemoryListMemberRepository", () => {
	let repo: InMemoryListMemberRepository;

	beforeEach(() => {
		repo = new InMemoryListMemberRepository();
	});

	describe("subscribe", () => {
		it("should create a new membership with unconfirmed status", async () => {
			const { member, created } = await repo.subscribe({
				subscriberId: "sub_1",
				listId: "lst_1",
			});
			expect(created).toBe(true);
			expect(member.status).toBe("unconfirmed");
		});

		it("should be idempotent on duplicate subscribe (criteria 6)", async () => {
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			const { member, created } = await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			expect(created).toBe(false);
			expect(member.subscriberId).toBe("sub_1");
		});
	});

	describe("confirm", () => {
		it("should transition status from unconfirmed to confirmed", async () => {
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			const confirmed = await repo.confirm("sub_1", "lst_1");
			expect(confirmed.status).toBe("confirmed");
			expect(confirmed.confirmedAt).toBeInstanceOf(Date);
		});

		it("should throw when confirming non-existent membership", async () => {
			await expect(repo.confirm("sub_ghost", "lst_ghost")).rejects.toThrow();
		});
	});

	describe("unsubscribe", () => {
		it("should set status to unsubscribed with timestamp (criteria 7)", async () => {
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			const result = await repo.unsubscribe("sub_1", "lst_1");
			expect(result.status).toBe("unsubscribed");
			expect(result.unsubscribedAt).toBeInstanceOf(Date);
		});

		it("should throw when unsubscribing non-existent membership", async () => {
			await expect(repo.unsubscribe("sub_ghost", "lst_ghost")).rejects.toThrow();
		});
	});

	describe("countConfirmed", () => {
		it("should count only confirmed members (criteria 8)", async () => {
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			await repo.subscribe({ subscriberId: "sub_2", listId: "lst_1" });
			await repo.confirm("sub_1", "lst_1");

			const count = await repo.countConfirmed("lst_1");
			expect(count).toBe(1);
		});

		it("should return 0 when no confirmed members", async () => {
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			const count = await repo.countConfirmed("lst_1");
			expect(count).toBe(0);
		});
	});

	describe("listBySubscriber", () => {
		it("should return only subscriptions for the given subscriber (criteria 10)", async () => {
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_2" });
			await repo.subscribe({ subscriberId: "sub_2", listId: "lst_1" });

			const result = await repo.listBySubscriber("sub_1");
			expect(result.items).toHaveLength(2);
			expect(result.items.every((m) => m.subscriberId === "sub_1")).toBe(true);
		});
	});

	describe("deleteExpiredUnconfirmed", () => {
		it("should delete unconfirmed rows older than cutoff", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
			const deleted = await repo.deleteExpiredUnconfirmed(new Date("2026-01-02T00:00:00Z"));
			expect(deleted).toBe(1);
			vi.useRealTimers();
		});

		it("should not delete confirmed memberships", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			await repo.confirm("sub_1", "lst_1");
			vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
			const deleted = await repo.deleteExpiredUnconfirmed(new Date("2026-01-02T00:00:00Z"));
			expect(deleted).toBe(0);
			vi.useRealTimers();
		});
	});

	describe("countByList", () => {
		it("should count all members of a list when no status filter is given", async () => {
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			await repo.subscribe({ subscriberId: "sub_2", listId: "lst_1" });
			await repo.subscribe({ subscriberId: "sub_3", listId: "lst_2" });

			const count = await repo.countByList("lst_1");
			expect(count).toBe(2);
		});

		it("should count only members matching the given status", async () => {
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			await repo.subscribe({ subscriberId: "sub_2", listId: "lst_1" });
			await repo.confirm("sub_1", "lst_1");

			expect(await repo.countByList("lst_1", "confirmed")).toBe(1);
			expect(await repo.countByList("lst_1", "unconfirmed")).toBe(1);
			expect(await repo.countByList("lst_1", "unsubscribed")).toBe(0);
		});

		it("should return 0 for a list with no members", async () => {
			expect(await repo.countByList("lst_empty")).toBe(0);
		});
	});

	describe("clear", () => {
		it("should drop all records and reset the id counter", async () => {
			await repo.subscribe({ subscriberId: "sub_1", listId: "lst_1" });
			repo.clear();

			expect(await repo.countByList("lst_1")).toBe(0);

			// Counter reset: first id after clear() is back to ...000001.
			const { member } = await repo.subscribe({ subscriberId: "sub_2", listId: "lst_1" });
			expect(member.id).toBe("lmb_mem_000001");
		});
	});
});

// ---------------------------------------------------------------------------
// MembershipService — criteria 3, 4, 5, 6, 7, 8
// ---------------------------------------------------------------------------

describe("MembershipService", () => {
	let listRepo: InMemoryListRepository;
	let memberRepo: InMemoryListMemberRepository;

	beforeEach(() => {
		listRepo = new InMemoryListRepository();
		memberRepo = new InMemoryListMemberRepository();
	});

	describe("subscribe to single-opt-in list (criteria 3)", () => {
		it("should create membership with confirmed status for single opt-in", async () => {
			listRepo.seed(makeListSeed({ id: "lst_001", slug: "newsletter", optinType: "single" }));
			const { service } = makeMembershipService(listRepo, memberRepo);

			const { member } = await service.subscribe("sub_1", "newsletter");

			expect(member.status).toBe("confirmed");
		});

		it("should increment memberCount on single opt-in subscribe", async () => {
			listRepo.seed(makeListSeed({ id: "lst_001", slug: "newsletter", optinType: "single" }));
			const { service } = makeMembershipService(listRepo, memberRepo);

			await service.subscribe("sub_1", "newsletter");

			const list = await listRepo.findById("lst_001");
			expect(list?.memberCount).toBe(1);
		});
	});

	describe("subscribe to double-opt-in list (criteria 4)", () => {
		it("should create membership with unconfirmed status for double opt-in", async () => {
			listRepo.seed(makeListSeed({ id: "lst_002", slug: "double-list", optinType: "double" }));
			const { service } = makeMembershipService(listRepo, memberRepo, { withEmailSender: true });

			const { member } = await service.subscribe("sub_1", "double-list");

			expect(member.status).toBe("unconfirmed");
		});

		it("should send confirmation email for double opt-in (criteria 4)", async () => {
			listRepo.seed(makeListSeed({ id: "lst_002", slug: "double-list", optinType: "double", name: "Double List" }));
			const { service, confirmEmailSender } = makeMembershipService(listRepo, memberRepo, {
				withEmailSender: true,
			});

			await service.subscribe("sub_1", "double-list");

			expect(confirmEmailSender?.sendConfirmationEmail).toHaveBeenCalledWith(
				"sub_1",
				expect.any(String),
				"Double List",
			);
		});

		it("should not increment memberCount on double opt-in subscribe (unconfirmed)", async () => {
			listRepo.seed(makeListSeed({ id: "lst_002", slug: "double-list", optinType: "double" }));
			const { service } = makeMembershipService(listRepo, memberRepo, { withEmailSender: true });

			await service.subscribe("sub_1", "double-list");

			const list = await listRepo.findById("lst_002");
			expect(list?.memberCount).toBe(0);
		});
	});

	describe("confirm (criteria 5)", () => {
		it("should transition from unconfirmed to confirmed via confirm()", async () => {
			listRepo.seed(makeListSeed({ id: "lst_002", slug: "double-list", optinType: "double" }));
			const { service } = makeMembershipService(listRepo, memberRepo, { withEmailSender: true });
			await service.subscribe("sub_1", "double-list");

			const { member, alreadyConfirmed } = await service.confirm("sub_1", "lst_002");

			expect(member.status).toBe("confirmed");
			expect(alreadyConfirmed).toBe(false);
		});

		it("should increment memberCount on confirm (criteria 8)", async () => {
			listRepo.seed(makeListSeed({ id: "lst_002", slug: "double-list", optinType: "double" }));
			const { service } = makeMembershipService(listRepo, memberRepo, { withEmailSender: true });
			await service.subscribe("sub_1", "double-list");

			await service.confirm("sub_1", "lst_002");

			const list = await listRepo.findById("lst_002");
			expect(list?.memberCount).toBe(1);
		});

		it("should return alreadyConfirmed=true if already confirmed", async () => {
			listRepo.seed(makeListSeed({ id: "lst_002", slug: "double-list", optinType: "double" }));
			const { service } = makeMembershipService(listRepo, memberRepo, { withEmailSender: true });
			await service.subscribe("sub_1", "double-list");
			await service.confirm("sub_1", "lst_002");

			const { alreadyConfirmed } = await service.confirm("sub_1", "lst_002");
			expect(alreadyConfirmed).toBe(true);
		});

		it("should throw when membership not found", async () => {
			const { service } = makeMembershipService(listRepo, memberRepo);
			await expect(service.confirm("sub_ghost", "lst_ghost")).rejects.toThrow();
		});
	});

	describe("duplicate subscribe idempotency (criteria 6)", () => {
		it("should return created=false on duplicate subscribe without error", async () => {
			listRepo.seed(makeListSeed({ id: "lst_001", slug: "newsletter", optinType: "single" }));
			const { service } = makeMembershipService(listRepo, memberRepo);

			await service.subscribe("sub_1", "newsletter");
			const { created } = await service.subscribe("sub_1", "newsletter");

			expect(created).toBe(false);
		});

		it("should not create duplicate rows on duplicate subscribe", async () => {
			listRepo.seed(makeListSeed({ id: "lst_001", slug: "newsletter", optinType: "single" }));
			const { service } = makeMembershipService(listRepo, memberRepo);

			await service.subscribe("sub_1", "newsletter");
			await service.subscribe("sub_1", "newsletter");

			const result = await memberRepo.listBySubscriber("sub_1");
			expect(result.items).toHaveLength(1);
		});
	});

	describe("unsubscribe (criteria 7)", () => {
		it("should set membership to unsubscribed status", async () => {
			listRepo.seed(makeListSeed({ id: "lst_001", slug: "newsletter", optinType: "single" }));
			const { service } = makeMembershipService(listRepo, memberRepo);
			await service.subscribe("sub_1", "newsletter");

			const member = await service.unsubscribe("sub_1", "newsletter");

			expect(member.status).toBe("unsubscribed");
			expect(member.unsubscribedAt).toBeInstanceOf(Date);
		});

		it("should decrement memberCount when a confirmed member unsubscribes (criteria 8)", async () => {
			listRepo.seed(makeListSeed({ id: "lst_001", slug: "newsletter", optinType: "single" }));
			const { service } = makeMembershipService(listRepo, memberRepo);
			await service.subscribe("sub_1", "newsletter"); // single opt-in: auto-confirmed + memberCount++

			await service.unsubscribe("sub_1", "newsletter");

			const list = await listRepo.findById("lst_001");
			expect(list?.memberCount).toBe(0);
		});

		it("should not decrement memberCount when unconfirmed member unsubscribes", async () => {
			listRepo.seed(makeListSeed({ id: "lst_002", slug: "double-list", optinType: "double" }));
			const { service } = makeMembershipService(listRepo, memberRepo, { withEmailSender: true });
			await service.subscribe("sub_1", "double-list");

			await service.unsubscribe("sub_1", "double-list");

			const list = await listRepo.findById("lst_002");
			expect(list?.memberCount).toBe(0);
		});

		it("should throw on unsubscribe from non-existent list", async () => {
			const { service } = makeMembershipService(listRepo, memberRepo);
			await expect(service.unsubscribe("sub_1", "ghost-list")).rejects.toThrow();
		});
	});

	describe("listSubscriptions (criteria 10)", () => {
		it("should return subscriber's own list memberships", async () => {
			listRepo.seed(makeListSeed({ id: "lst_001", slug: "newsletter", optinType: "single" }));
			listRepo.seed(makeListSeed({ id: "lst_002", slug: "announcements", optinType: "single", name: "Announcements" }));
			const { service } = makeMembershipService(listRepo, memberRepo);

			await service.subscribe("sub_1", "newsletter");
			await service.subscribe("sub_1", "announcements");
			await service.subscribe("sub_2", "newsletter");

			const result = await service.listSubscriptions("sub_1");
			expect(result.items).toHaveLength(2);
			expect(result.items.every((m) => m.subscriberId === "sub_1")).toBe(true);
		});
	});

	describe("subscribe to archived list", () => {
		it("should throw when subscribing to archived list", async () => {
			const list = await listRepo.create({ name: "Old", slug: "old-list" });
			await listRepo.archive(list.id);
			const { service } = makeMembershipService(listRepo, memberRepo);

			await expect(service.subscribe("sub_1", "old-list")).rejects.toThrow();
		});
	});
});

// ---------------------------------------------------------------------------
// ListMemberConfirmAdapter (criteria 5)
// ---------------------------------------------------------------------------

describe("ListMemberConfirmAdapter", () => {
	let listRepo: InMemoryListRepository;
	let memberRepo: InMemoryListMemberRepository;

	beforeEach(() => {
		listRepo = new InMemoryListRepository();
		memberRepo = new InMemoryListMemberRepository();
	});

	it("should confirm membership and increment memberCount", async () => {
		listRepo.seed(makeListSeed({ id: "lst_001" }));
		await memberRepo.subscribe({ subscriberId: "sub_1", listId: "lst_001" });
		const adapter = new ListMemberConfirmAdapter(memberRepo, listRepo);

		const result = await adapter.confirmMembership("sub_1", "lst_001");

		expect(result.alreadyConfirmed).toBe(false);
		const member = await memberRepo.findBySubscriberAndList("sub_1", "lst_001");
		expect(member?.status).toBe("confirmed");
		const list = await listRepo.findById("lst_001");
		expect(list?.memberCount).toBe(1);
	});

	it("should return alreadyConfirmed=true and not double-count when already confirmed", async () => {
		listRepo.seed(makeListSeed({ id: "lst_001" }));
		await memberRepo.subscribe({ subscriberId: "sub_1", listId: "lst_001" });
		await memberRepo.confirm("sub_1", "lst_001");
		await listRepo.updateMemberCount("lst_001", 1); // simulate first confirm
		const adapter = new ListMemberConfirmAdapter(memberRepo, listRepo);

		const result = await adapter.confirmMembership("sub_1", "lst_001");

		expect(result.alreadyConfirmed).toBe(true);
		const list = await listRepo.findById("lst_001");
		expect(list?.memberCount).toBe(1); // not incremented again
	});

	it("should return alreadyConfirmed=false and not throw when membership not found", async () => {
		listRepo.seed(makeListSeed({ id: "lst_001" }));
		const adapter = new ListMemberConfirmAdapter(memberRepo, listRepo);

		const result = await adapter.confirmMembership("sub_ghost", "lst_001");
		expect(result.alreadyConfirmed).toBe(false);
	});
});
