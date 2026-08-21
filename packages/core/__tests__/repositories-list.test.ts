/**
 * Contract tests for list/cursor methods on the repository interfaces, run
 * against the in-memory implementations.
 *
 * These tests define the expected behaviour of the list/pagination methods that
 * the server layer calls for REST endpoints.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemorySubscriberRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "../src/repositories/in-memory/index";
import type { CursorResult } from "../src/repositories/types";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

let _counter = 0;
function nextId(): string {
	return `test_${++_counter}`;
}

function createSubscriberRecord(
	overrides: Partial<{
		id: string;
		email: string;
		phone: string;
		locale: string;
		timezone: string | null;
		globallyUnsubscribed: boolean;
		metadata: Record<string, unknown>;
		erasedAt: Date | null;
		createdAt: Date;
		updatedAt: Date;
	}> = {},
) {
	const id = nextId();
	return {
		id,
		email: `user${id}@example.com`,
		phone: undefined,
		locale: "en",
		timezone: undefined,
		globallyUnsubscribed: false,
		metadata: {},
		erasedAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function createNotificationData(
	overrides: Partial<{
		id: string;
		subscriberId: string;
		workspaceId: string;
		eventType: string;
		category: string;
		channel: "email" | "sms" | "push" | "in-app" | "webhook" | "slack";
		status: "pending" | "sent" | "delivered" | "failed" | "bounced" | "suppressed";
		payload: Record<string, unknown>;
		metadata: Record<string, unknown>;
	}> = {},
) {
	return {
		subscriberId: `sub_${nextId()}`,
		eventType: "user.welcome",
		category: "transactional",
		channel: "email" as const,
		status: "pending" as const,
		payload: {},
		metadata: {},
		...overrides,
	};
}

function createInboxData(
	overrides: Partial<{
		subscriberId: string;
		workspaceId: string;
		eventType: string;
		category: string;
		subject: string | null;
		body: string;
		data: Record<string, unknown>;
	}> = {},
) {
	return {
		subscriberId: `sub_${nextId()}`,
		eventType: "user.welcome",
		category: "transactional",
		subject: "Welcome",
		body: "Hello!",
		data: {},
		...overrides,
	};
}

function createPreferenceRecord(
	overrides: Partial<{
		id: string;
		subscriberId: string;
		workspaceId: string;
		topicKey: string;
		channel: "email" | "sms" | "push" | "in-app" | "webhook" | "slack";
		enabled: boolean;
	}> = {},
) {
	return {
		subscriberId: `sub_${nextId()}`,
		topicKey: "general",
		channel: "email" as const,
		enabled: true,
		...overrides,
	};
}

function createSuppressionData(
	overrides: Partial<{
		address: string;
		channel: "email" | "sms" | "push" | "in-app" | "webhook" | "slack";
		reason: string;
		provider: string;
	}> = {},
) {
	const id = nextId();
	return {
		address: `user${id}@example.com`,
		channel: "email" as const,
		reason: "bounce",
		...overrides,
	};
}

function createDeadLetterData(
	overrides: Partial<{
		notificationId: string;
		subscriberId: string;
		eventType: string;
		channel: "email" | "sms" | "push" | "in-app" | "webhook" | "slack";
		attempts: Array<{ provider: string; timestamp: Date; errorCode: string; errorMessage: string }>;
		payload: Record<string, unknown>;
	}> = {},
) {
	return {
		notificationId: `notif_${nextId()}`,
		subscriberId: `sub_${nextId()}`,
		eventType: "user.welcome",
		channel: "email" as const,
		attempts: [
			{
				provider: "sendgrid",
				timestamp: new Date("2026-01-01T00:00:00Z"),
				errorCode: "PROVIDER_UNAVAILABLE",
				errorMessage: "Connection refused",
			},
		],
		payload: {},
		...overrides,
	};
}

function createIntegrationRecord(
	overrides: Partial<{
		id: string;
		ownerId: string;
		subscriberId: string;
		name: string;
		channel: "email" | "sms" | "push" | "in-app" | "webhook" | "slack";
		events: string[];
		config: Record<string, unknown>;
		active: boolean;
		createdAt: Date;
	}> = {},
) {
	return {
		id: nextId(),
		ownerId: `owner_${nextId()}`,
		subscriberId: undefined,
		name: undefined,
		channel: "slack" as const,
		events: undefined,
		config: { webhookUrl: "https://hooks.slack.com/test" },
		active: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function createWorkspaceDefaultRecord(
	overrides: Partial<{
		workspaceId: string;
		topicKey: string;
		channel: "email" | "sms" | "push" | "in-app" | "webhook" | "slack";
		enabled: boolean;
		isMandatory: boolean;
	}> = {},
) {
	return {
		workspaceId: `ws_${nextId()}`,
		topicKey: "general",
		channel: "email" as const,
		enabled: true,
		isMandatory: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Assertion helper for CursorResult shape
// ---------------------------------------------------------------------------

function assertCursorResult<T>(result: unknown): asserts result is CursorResult<T> {
	expect(result).toMatchObject({
		items: expect.any(Array),
		hasMore: expect.any(Boolean),
	});
}

// ---------------------------------------------------------------------------
// NotificationRepository — list + listCrossWorkspace
// ---------------------------------------------------------------------------

describe("NotificationRepository", () => {
	let repo: InMemoryNotificationRepository;

	beforeEach(() => {
		repo = new InMemoryNotificationRepository();
	});

	describe("list", () => {
		it("should return items only for the specified subscriber", async () => {
			const subscriberId = "sub_notif_list";
			await repo.create(createNotificationData({ subscriberId, eventType: "user.welcome" }));
			await repo.create(createNotificationData({ subscriberId, eventType: "user.password_reset" }));
			await repo.create(createNotificationData({ subscriberId: "sub_other" }));

			const result = await repo.list(subscriberId);

			assertCursorResult(result);
			expect(result.items).toHaveLength(2);
			expect(
				result.items.every((n: { subscriberId: string }) => n.subscriberId === subscriberId),
			).toBe(true);
			expect(result.hasMore).toBe(false);
		});

		it("should return empty items and hasMore=false when subscriber has no notifications", async () => {
			const result = await repo.list("sub_empty");

			assertCursorResult(result);
			expect(result.items).toEqual([]);
			expect(result.hasMore).toBe(false);
		});

		it("should respect limit and set hasMore=true when more records exist", async () => {
			const subscriberId = "sub_paginate";
			await repo.create(createNotificationData({ subscriberId }));
			await repo.create(createNotificationData({ subscriberId }));
			await repo.create(createNotificationData({ subscriberId }));

			const result = await repo.list(subscriberId, { limit: 2 });

			assertCursorResult(result);
			expect(result.items).toHaveLength(2);
			expect(result.hasMore).toBe(true);
			expect(result.cursor).toBeDefined();
		});

		it("should return cursor=undefined and hasMore=false on last page", async () => {
			const subscriberId = "sub_lastpage";
			await repo.create(createNotificationData({ subscriberId }));

			const result = await repo.list(subscriberId, { limit: 10 });

			assertCursorResult(result);
			expect(result.hasMore).toBe(false);
			expect(result.cursor).toBeUndefined();
		});

		it("should support cursor-based traversal to retrieve all records across pages", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			const subscriberId = "sub_cursor_walk";
			// Insert with distinct timestamps for deterministic cursor ordering
			for (let i = 0; i < 3; i++) {
				vi.advanceTimersByTime(1000);
				await repo.create(createNotificationData({ subscriberId }));
			}
			vi.useRealTimers();

			const page1 = await repo.list(subscriberId, { limit: 2 });
			assertCursorResult(page1);
			expect(page1.items).toHaveLength(2);
			expect(page1.hasMore).toBe(true);

			const page2 = await repo.list(subscriberId, { limit: 2, cursor: page1.cursor });
			assertCursorResult(page2);
			expect(page2.items).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
		});

		it("should filter by status when provided", async () => {
			const subscriberId = "sub_status_filter";
			const n1 = await repo.create(createNotificationData({ subscriberId }));
			await repo.create(createNotificationData({ subscriberId }));
			await repo.updateStatus(n1.id, "delivered");

			const result = await repo.list(subscriberId, { status: "delivered" });

			assertCursorResult(result);
			expect(result.items).toHaveLength(1);
			expect((result.items[0] as { status: string }).status).toBe("delivered");
		});

		it("should filter by category when provided", async () => {
			const subscriberId = "sub_cat_filter";
			await repo.create(createNotificationData({ subscriberId, category: "transactional" }));
			await repo.create(createNotificationData({ subscriberId, category: "marketing" }));

			const result = await repo.list(subscriberId, { category: "transactional" });

			assertCursorResult(result);
			expect(result.items).toHaveLength(1);
			expect((result.items[0] as { category: string }).category).toBe("transactional");
		});

		it("should apply no filter when filter object is omitted", async () => {
			const subscriberId = "sub_no_filter";
			await repo.create(createNotificationData({ subscriberId, category: "transactional" }));
			await repo.create(createNotificationData({ subscriberId, category: "marketing" }));

			const result = await repo.list(subscriberId);

			assertCursorResult(result);
			expect(result.items).toHaveLength(2);
		});
	});

	describe("listCrossWorkspace", () => {
		it("should return notifications across all subscribers", async () => {
			const freshRepo = new InMemoryNotificationRepository();
			await freshRepo.create(createNotificationData({ subscriberId: "sub_cw_1" }));
			await freshRepo.create(createNotificationData({ subscriberId: "sub_cw_2" }));
			await freshRepo.create(createNotificationData({ subscriberId: "sub_cw_3" }));

			const result = await freshRepo.listCrossWorkspace();

			assertCursorResult(result);
			expect(result.items).toHaveLength(3);
		});

		it("should return empty items when no notifications exist", async () => {
			const freshRepo = new InMemoryNotificationRepository();
			const result = await freshRepo.listCrossWorkspace();

			assertCursorResult(result);
			expect(result.items).toEqual([]);
			expect(result.hasMore).toBe(false);
		});

		it("should respect limit and return hasMore=true when records exceed limit", async () => {
			const freshRepo = new InMemoryNotificationRepository();
			await freshRepo.create(createNotificationData({ subscriberId: "sub_cw_a" }));
			await freshRepo.create(createNotificationData({ subscriberId: "sub_cw_b" }));
			await freshRepo.create(createNotificationData({ subscriberId: "sub_cw_c" }));

			const result = await freshRepo.listCrossWorkspace({ limit: 2 });

			assertCursorResult(result);
			expect(result.items).toHaveLength(2);
			expect(result.hasMore).toBe(true);
		});

		it("should filter by status when provided", async () => {
			const freshRepo = new InMemoryNotificationRepository();
			const n1 = await freshRepo.create(createNotificationData({ subscriberId: "sub_cw_st" }));
			await freshRepo.create(createNotificationData({ subscriberId: "sub_cw_st2" }));
			await freshRepo.updateStatus(n1.id, "failed");

			const result = await freshRepo.listCrossWorkspace({ status: "failed" });

			assertCursorResult(result);
			expect(result.items).toHaveLength(1);
		});
	});
});

// ---------------------------------------------------------------------------
// InboxRepository — findBySubscriber, updateReadAt, updateArchivedAt, unreadCount
// ---------------------------------------------------------------------------

describe("InboxRepository", () => {
	let repo: InMemoryInboxRepository;

	beforeEach(() => {
		repo = new InMemoryInboxRepository();
	});

	describe("findBySubscriber", () => {
		it("should return inbox items only for the specified subscriber", async () => {
			const subscriberId = "sub_inbox_list";
			await repo.create(createInboxData({ subscriberId }));
			await repo.create(createInboxData({ subscriberId }));
			await repo.create(createInboxData({ subscriberId: "sub_other_inbox" }));

			const result = await repo.findBySubscriber(subscriberId);

			assertCursorResult(result);
			expect(result.items).toHaveLength(2);
			expect(
				result.items.every((i: { subscriberId: string }) => i.subscriberId === subscriberId),
			).toBe(true);
		});

		it("should return empty items when subscriber has no inbox entries", async () => {
			const result = await repo.findBySubscriber("sub_no_inbox");

			assertCursorResult(result);
			expect(result.items).toEqual([]);
			expect(result.hasMore).toBe(false);
		});

		it("should respect limit and set hasMore=true when more records exist", async () => {
			const subscriberId = "sub_inbox_paginate";
			await repo.create(createInboxData({ subscriberId }));
			await repo.create(createInboxData({ subscriberId }));
			await repo.create(createInboxData({ subscriberId }));

			const result = await repo.findBySubscriber(subscriberId, { limit: 2 });

			assertCursorResult(result);
			expect(result.items).toHaveLength(2);
			expect(result.hasMore).toBe(true);
		});

		it("should support cursor traversal across pages", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			const subscriberId = "sub_inbox_cursor";
			for (let i = 0; i < 3; i++) {
				vi.advanceTimersByTime(1000);
				await repo.create(createInboxData({ subscriberId }));
			}
			vi.useRealTimers();

			const page1 = await repo.findBySubscriber(subscriberId, { limit: 2 });
			expect(page1.items).toHaveLength(2);
			expect(page1.hasMore).toBe(true);

			const page2 = await repo.findBySubscriber(subscriberId, {
				limit: 2,
				cursor: page1.cursor,
			});
			expect(page2.items).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
		});

		it("should filter to unread items when status=unread", async () => {
			const subscriberId = "sub_inbox_unread";
			const item = await repo.create(createInboxData({ subscriberId }));
			await repo.create(createInboxData({ subscriberId }));
			// Mark one as read
			await repo.updateReadAt(item.id);

			const result = await repo.findBySubscriber(subscriberId, { status: "unread" });

			assertCursorResult(result);
			expect(result.items.every((i: { readAt?: Date }) => i.readAt == null)).toBe(true);
		});

		it("should filter to archived items when status=archived", async () => {
			const subscriberId = "sub_inbox_archived";
			const item = await repo.create(createInboxData({ subscriberId }));
			await repo.create(createInboxData({ subscriberId }));
			await repo.updateArchivedAt(item.id);

			const result = await repo.findBySubscriber(subscriberId, { status: "archived" });

			assertCursorResult(result);
			expect(result.items).toHaveLength(1);
			expect(result.items[0]).toMatchObject({ id: item.id });
		});

		it("should filter by category when provided", async () => {
			const subscriberId = "sub_inbox_cat";
			await repo.create(createInboxData({ subscriberId, category: "transactional" }));
			await repo.create(createInboxData({ subscriberId, category: "marketing" }));

			const result = await repo.findBySubscriber(subscriberId, { category: "transactional" });

			assertCursorResult(result);
			expect(result.items).toHaveLength(1);
			expect((result.items[0] as { category: string }).category).toBe("transactional");
		});
	});

	describe("updateReadAt", () => {
		it("should set readAt on the inbox item", async () => {
			const item = await repo.create(createInboxData({ subscriberId: "sub_markread" }));
			expect(item.readAt).toBeUndefined();

			await repo.updateReadAt(item.id);

			const all = repo.getAll();
			const updated = all.find((i) => i.id === item.id);
			expect(updated?.readAt).toBeInstanceOf(Date);
		});

		it("should not affect other inbox items", async () => {
			const item1 = await repo.create(createInboxData({ subscriberId: "sub_markread_isolation" }));
			const item2 = await repo.create(createInboxData({ subscriberId: "sub_markread_isolation" }));

			await repo.updateReadAt(item1.id);

			const all = repo.getAll();
			const untouched = all.find((i) => i.id === item2.id);
			expect(untouched?.readAt).toBeUndefined();
		});
	});

	describe("updateArchivedAt", () => {
		it("should set archivedAt on the inbox item", async () => {
			const item = await repo.create(createInboxData({ subscriberId: "sub_archive" }));

			await repo.updateArchivedAt(item.id);

			const all = repo.getAll();
			const updated = all.find((i) => i.id === item.id);
			expect(updated?.archivedAt).toBeInstanceOf(Date);
		});

		it("should not affect other inbox items", async () => {
			const item1 = await repo.create(createInboxData({ subscriberId: "sub_archive_isolation" }));
			const item2 = await repo.create(createInboxData({ subscriberId: "sub_archive_isolation" }));

			await repo.updateArchivedAt(item1.id);

			const all = repo.getAll();
			const untouched = all.find((i) => i.id === item2.id);
			expect(untouched?.archivedAt).toBeUndefined();
		});
	});

	describe("unreadCount", () => {
		it("should return count of unread non-archived items for subscriber", async () => {
			const subscriberId = "sub_unread_count";
			const item1 = await repo.create(createInboxData({ subscriberId }));
			await repo.create(createInboxData({ subscriberId }));
			await repo.updateReadAt(item1.id);

			const count = await repo.unreadCount(subscriberId);

			expect(count).toBe(1);
		});

		it("should return 0 when subscriber has no items", async () => {
			const count = await repo.unreadCount("sub_no_items");
			expect(count).toBe(0);
		});

		it("should not count archived items as unread", async () => {
			const subscriberId = "sub_archived_not_unread";
			const item = await repo.create(createInboxData({ subscriberId }));
			await repo.updateArchivedAt(item.id);

			const count = await repo.unreadCount(subscriberId);

			expect(count).toBe(0);
		});

		it("should not count items from other subscribers", async () => {
			await repo.create(createInboxData({ subscriberId: "sub_other_unread" }));

			const count = await repo.unreadCount("sub_mine");

			expect(count).toBe(0);
		});

		it("should return 0 when all items are read", async () => {
			const subscriberId = "sub_all_read";
			const item = await repo.create(createInboxData({ subscriberId }));
			await repo.updateReadAt(item.id);

			const count = await repo.unreadCount(subscriberId);

			expect(count).toBe(0);
		});
	});
});

// ---------------------------------------------------------------------------
// SubscriberRepository — list, create, erase
// ---------------------------------------------------------------------------

describe("SubscriberRepository", () => {
	let repo: InMemorySubscriberRepository;

	beforeEach(() => {
		repo = new InMemorySubscriberRepository();
	});

	describe("list", () => {
		it("should return all non-erased subscribers", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			freshRepo.seed({
				id: "sub_list_a",
				email: "a@example.com",
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			});
			freshRepo.seed({
				id: "sub_list_b",
				email: "b@example.com",
				createdAt: new Date("2026-01-01T00:01:00Z"),
				updatedAt: new Date("2026-01-01T00:01:00Z"),
			});
			freshRepo.seed({
				id: "sub_list_erased",
				email: undefined,
				erasedAt: new Date("2026-02-01T00:00:00Z"),
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-02-01T00:00:00Z"),
			});

			const result = await freshRepo.list();

			assertCursorResult(result);
			expect(result.items.every((s: { erasedAt?: Date | null }) => !s.erasedAt)).toBe(true);
			expect(result.items).toHaveLength(2);
		});

		it("should return empty items when no subscribers exist", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			const result = await freshRepo.list();
			assertCursorResult(result);
			expect(result.items).toEqual([]);
		});

		it("should respect limit and provide cursor for next page", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			for (let i = 0; i < 5; i++) {
				freshRepo.seed({
					id: `sub_pg_${i}`,
					createdAt: new Date(2026, 0, 1, 0, 0, i),
					updatedAt: new Date(2026, 0, 1, 0, 0, i),
				});
			}

			const result = await freshRepo.list({ limit: 3 });

			assertCursorResult(result);
			expect(result.items).toHaveLength(3);
			expect(result.hasMore).toBe(true);
			expect(result.cursor).toBeDefined();
		});

		it("should traverse all records via cursor pagination", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			for (let i = 0; i < 4; i++) {
				freshRepo.seed({
					id: `sub_walk_${i}`,
					createdAt: new Date(2026, 0, 1, 0, 0, i),
					updatedAt: new Date(2026, 0, 1, 0, 0, i),
				});
			}

			const page1 = await freshRepo.list({ limit: 3 });
			expect(page1.items).toHaveLength(3);
			expect(page1.hasMore).toBe(true);

			const page2 = await freshRepo.list({ limit: 3, cursor: page1.cursor });
			expect(page2.items).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
		});

		it("should not include erased subscribers in list results", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			freshRepo.seed({
				id: "sub_erased_hidden",
				erasedAt: new Date("2026-02-01T00:00:00Z"),
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-02-01T00:00:00Z"),
			});

			const result = await freshRepo.list();

			assertCursorResult(result);
			expect(result.items.every((s: { id: string }) => s.id !== "sub_erased_hidden")).toBe(true);
		});
	});

	describe("create", () => {
		it("should create a subscriber record and make it findable", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			const result = await freshRepo.create({
				id: "sub_created",
				email: "created@example.com",
			});

			expect(result).toMatchObject({ id: "sub_created", email: "created@example.com" });
			const found = await freshRepo.findById("sub_created");
			expect(found).not.toBeNull();
			expect(found?.id).toBe("sub_created");
		});

		it("should leave lang undefined when not provided", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			const result = await freshRepo.create({ id: "sub_lang_default" });

			expect(result.lang).toBeUndefined();
		});

		it("should create subscriber with optional email omitted", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			const result = await freshRepo.create({ id: "sub_no_email" });

			expect(result.id).toBe("sub_no_email");
			expect(result.email).toBeUndefined();
		});

		it("should set createdAt and updatedAt timestamps on creation", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			const result = await freshRepo.create({ id: "sub_timestamps" });

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
		});

		it("should preserve provided metadata", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			const metadata = { plan: "pro", source: "signup" };
			const result = await freshRepo.create({ id: "sub_metadata", metadata });

			expect(result.metadata).toEqual(metadata);
		});
	});

	describe("erase", () => {
		it("should set erasedAt on the subscriber", async () => {
			repo.seed({
				id: "sub_erase",
				email: "erase@example.com",
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			});

			await repo.erase("sub_erase");

			const found = await repo.findById("sub_erase");
			expect(found?.erasedAt).toBeInstanceOf(Date);
		});

		it("should return zero cascade counts (the in-memory repo owns only the subscriber row)", async () => {
			repo.seed({
				id: "sub_erase_counts",
				email: "counts@example.com",
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			});

			const counts = await repo.erase("sub_erase_counts");

			expect(counts).toEqual({
				notifications: 0,
				inboxItems: 0,
				pushTokens: 0,
				personalIntegrations: 0,
				preferences: 0,
				deadLetters: 0,
			});
		});

		it("should clear email PII on erasure", async () => {
			repo.seed({
				id: "sub_pii_erase",
				email: "pii@example.com",
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			});

			await repo.erase("sub_pii_erase");

			const found = await repo.findById("sub_pii_erase");
			expect(found?.email).toBeUndefined();
		});

		it("should clear phone PII on erasure", async () => {
			repo.seed({
				id: "sub_phone_erase",
				phone: "+15550001111",
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			});

			await repo.erase("sub_phone_erase");

			const found = await repo.findById("sub_phone_erase");
			expect(found?.phone).toBeUndefined();
		});

		it("should not appear in list() after erasure", async () => {
			const freshRepo = new InMemorySubscriberRepository();
			freshRepo.seed({
				id: "sub_erase_hidden",
				email: "hidden@example.com",
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			});
			await freshRepo.erase("sub_erase_hidden");

			const result = await freshRepo.list();

			assertCursorResult(result);
			expect(result.items.every((s: { id: string }) => s.id !== "sub_erase_hidden")).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// SuppressionRepository — list, add, remove
// ---------------------------------------------------------------------------

describe("SuppressionRepository", () => {
	let repo: InMemorySuppressionRepository;

	beforeEach(() => {
		repo = new InMemorySuppressionRepository();
	});

	describe("list", () => {
		it("should return all suppression records", async () => {
			const freshRepo = new InMemorySuppressionRepository();
			await freshRepo.create(createSuppressionData({ address: "bounce1@example.com" }));
			await freshRepo.create(createSuppressionData({ address: "bounce2@example.com" }));

			const result = await freshRepo.list();

			assertCursorResult(result);
			expect(result.items).toHaveLength(2);
		});

		it("should return empty items when no suppressions exist", async () => {
			const freshRepo = new InMemorySuppressionRepository();
			const result = await freshRepo.list();
			assertCursorResult(result);
			expect(result.items).toEqual([]);
		});

		it("should respect limit and set hasMore=true when more records exist", async () => {
			const freshRepo = new InMemorySuppressionRepository();
			await freshRepo.create(createSuppressionData({ address: "s1@example.com" }));
			await freshRepo.create(createSuppressionData({ address: "s2@example.com" }));
			await freshRepo.create(createSuppressionData({ address: "s3@example.com" }));

			const result = await freshRepo.list({ limit: 2 });

			assertCursorResult(result);
			expect(result.items).toHaveLength(2);
			expect(result.hasMore).toBe(true);
		});

		it("should filter by channel when provided", async () => {
			const freshRepo = new InMemorySuppressionRepository();
			await freshRepo.create(
				createSuppressionData({ address: "email1@example.com", channel: "email" }),
			);
			await freshRepo.create(createSuppressionData({ address: "+15550001111", channel: "sms" }));

			const result = await freshRepo.list({ channel: "email" });

			assertCursorResult(result);
			expect(result.items.every((s: { channel: string }) => s.channel === "email")).toBe(true);
		});

		it("should support cursor traversal", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			const freshRepo = new InMemorySuppressionRepository();
			for (const addr of ["cur1@example.com", "cur2@example.com", "cur3@example.com"]) {
				vi.advanceTimersByTime(1000);
				await freshRepo.create(createSuppressionData({ address: addr }));
			}
			vi.useRealTimers();

			const page1 = await freshRepo.list({ limit: 2 });
			expect(page1.hasMore).toBe(true);

			const page2 = await freshRepo.list({ limit: 2, cursor: page1.cursor });
			expect(page2.items).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
		});
	});

	describe("create", () => {
		it("should create suppression and make it findable by address+channel", async () => {
			const freshRepo = new InMemorySuppressionRepository();
			await freshRepo.create(
				createSuppressionData({ address: "added@example.com", channel: "email" }),
			);

			const found = await freshRepo.findByAddressAndChannel("added@example.com", "email");
			expect(found).not.toBeNull();
			expect(found?.address).toBe("added@example.com");
		});

		it("should store the reason on the suppression record", async () => {
			const freshRepo = new InMemorySuppressionRepository();
			await freshRepo.create(
				createSuppressionData({ address: "reason@example.com", reason: "spam" }),
			);

			const found = await freshRepo.findByAddressAndChannel("reason@example.com", "email");
			expect(found?.reason).toBe("spam");
		});
	});

	describe("archive", () => {
		it("should archive a suppression record and return true", async () => {
			await repo.create(createSuppressionData({ address: "remove@example.com", channel: "email" }));

			const result = await repo.archive("remove@example.com", "email");

			expect(result).toBe(true);
			const found = await repo.findByAddressAndChannel("remove@example.com", "email");
			expect(found).toBeNull();
		});

		it("should return false when no matching record exists", async () => {
			const result = await repo.archive("ghost@example.com", "email");
			expect(result).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// DeadLetterRepository — list, findById, resolve
// ---------------------------------------------------------------------------

describe("DeadLetterRepository", () => {
	let repo: InMemoryDeadLetterRepository;

	beforeEach(() => {
		repo = new InMemoryDeadLetterRepository();
	});

	describe("list", () => {
		it("should return unresolved dead letter records by default", async () => {
			const freshRepo = new InMemoryDeadLetterRepository();
			await freshRepo.create(createDeadLetterData());
			const resolved = await freshRepo.create(createDeadLetterData());
			await freshRepo.resolve(resolved.id, "manual-discard");

			const result = await freshRepo.list();

			assertCursorResult(result);
			// Default: only unresolved
			expect(result.items.every((d: { resolvedAt?: Date }) => !d.resolvedAt)).toBe(true);
		});

		it("should return empty items when no unresolved records exist", async () => {
			const freshRepo = new InMemoryDeadLetterRepository();
			const result = await freshRepo.list();
			assertCursorResult(result);
			expect(result.items).toEqual([]);
		});

		it("should respect limit and return hasMore=true when records exceed limit", async () => {
			const freshRepo = new InMemoryDeadLetterRepository();
			await freshRepo.create(createDeadLetterData());
			await freshRepo.create(createDeadLetterData());
			await freshRepo.create(createDeadLetterData());

			const result = await freshRepo.list({ limit: 2 });

			assertCursorResult(result);
			expect(result.items).toHaveLength(2);
			expect(result.hasMore).toBe(true);
		});

		it("should support cursor traversal", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			const freshRepo = new InMemoryDeadLetterRepository();
			for (let i = 0; i < 3; i++) {
				vi.advanceTimersByTime(1000);
				await freshRepo.create(createDeadLetterData());
			}
			vi.useRealTimers();

			const page1 = await freshRepo.list({ limit: 2 });
			expect(page1.hasMore).toBe(true);

			const page2 = await freshRepo.list({ limit: 2, cursor: page1.cursor });
			expect(page2.items).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
		});

		it("should return resolved records when resolved=true is specified", async () => {
			const freshRepo = new InMemoryDeadLetterRepository();
			await freshRepo.create(createDeadLetterData());
			const resolved = await freshRepo.create(createDeadLetterData());
			await freshRepo.resolve(resolved.id, "discarded");

			const result = await freshRepo.list({ resolved: true });

			assertCursorResult(result);
			// resolved=true includes all, not just resolved
			expect(result.items.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("findById", () => {
		it("should return a dead letter record by id", async () => {
			const created = await repo.create(createDeadLetterData({ notificationId: "notif_dlq_find" }));

			const found = await repo.findById(created.id);

			expect(found).toMatchObject({ id: created.id, notificationId: "notif_dlq_find" });
		});

		it("should return null for unknown id", async () => {
			const found = await repo.findById("dlq_ghost");
			expect(found).toBeNull();
		});

		it("should return null for empty string id", async () => {
			const found = await repo.findById("");
			expect(found).toBeNull();
		});
	});

	describe("resolve", () => {
		it("should set resolvedAt and resolution on the record", async () => {
			const created = await repo.create(createDeadLetterData());

			await repo.resolve(created.id, "manual-discard");

			const found = await repo.findById(created.id);
			expect(found?.resolvedAt).toBeInstanceOf(Date);
			expect(found?.resolution).toBe("manual-discard");
		});

		it("should not affect other dead letter records", async () => {
			const r1 = await repo.create(createDeadLetterData());
			const r2 = await repo.create(createDeadLetterData());

			await repo.resolve(r1.id, "discarded");

			const r2Found = await repo.findById(r2.id);
			expect(r2Found?.resolvedAt).toBeUndefined();
		});
	});
});

// ---------------------------------------------------------------------------
// PreferenceRepository — listBySubscriber
// ---------------------------------------------------------------------------

describe("PreferenceRepository", () => {
	let repo: InMemoryPreferenceRepository;

	beforeEach(() => {
		repo = new InMemoryPreferenceRepository();
	});

	describe("listBySubscriber", () => {
		it("should return all preferences for subscriber", async () => {
			const subscriberId = "sub_pref_list";
			const pref1 = createPreferenceRecord({ subscriberId, topicKey: "alerts" });
			const pref2 = createPreferenceRecord({ subscriberId, topicKey: "billing" });
			await repo.seed(pref1);
			await repo.seed(pref2);

			const result = await repo.listBySubscriber(subscriberId);

			expect(result).toHaveLength(2);
			expect(result.every((p) => p.subscriberId === subscriberId)).toBe(true);
		});

		it("should return empty array when subscriber has no preferences", async () => {
			const result = await repo.listBySubscriber("sub_no_prefs_list");
			expect(result).toEqual([]);
		});

		it("should not return preferences from other subscribers", async () => {
			const pref = createPreferenceRecord({ subscriberId: "sub_other_pref" });
			await repo.seed(pref);

			const result = await repo.listBySubscriber("sub_mine_pref");

			expect(result).toEqual([]);
		});

		it("should return all preferences regardless of channel or topicKey", async () => {
			const subscriberId = "sub_pref_all";
			await repo.seed(createPreferenceRecord({ subscriberId, topicKey: "a", channel: "email" }));
			await repo.seed(createPreferenceRecord({ subscriberId, topicKey: "b", channel: "sms" }));
			await repo.seed(createPreferenceRecord({ subscriberId, topicKey: "c", channel: "push" }));

			const result = await repo.listBySubscriber(subscriberId);

			expect(result).toHaveLength(3);
		});
	});
});

// ---------------------------------------------------------------------------
// IntegrationRepository — listBySubscriber, listByWorkspace
// ---------------------------------------------------------------------------

describe("IntegrationRepository", () => {
	let repo: InMemoryIntegrationRepository;

	beforeEach(() => {
		repo = new InMemoryIntegrationRepository();
	});

	describe("listBySubscriber", () => {
		it("should return active integrations for subscriber", async () => {
			const subscriberId = "sub_integ_list";
			await repo.seed(createIntegrationRecord({ subscriberId, channel: "slack", active: true }));
			await repo.seed(createIntegrationRecord({ subscriberId, channel: "telegram", active: true }));
			await repo.seed(
				createIntegrationRecord({ subscriberId: "sub_other_integ", channel: "slack" }),
			);

			const result = await repo.listBySubscriber(subscriberId);

			expect(result).toHaveLength(2);
			expect(result.every((i) => i.subscriberId === subscriberId)).toBe(true);
		});

		it("should return empty array when subscriber has no integrations", async () => {
			const result = await repo.listBySubscriber("sub_no_integs");
			expect(result).toEqual([]);
		});

		it("should not return inactive integrations", async () => {
			const subscriberId = "sub_inactive_integ";
			await repo.seed(createIntegrationRecord({ subscriberId, active: false }));

			const result = await repo.listBySubscriber(subscriberId);

			expect(result).toEqual([]);
		});
	});

	describe("listByWorkspace", () => {
		it("should return workspace-owned active integrations", async () => {
			const workspaceId = "ws_integ_list";
			await repo.seed(
				createIntegrationRecord({
					ownerId: workspaceId,
					channel: "slack",
					subscriberId: undefined,
				}),
			);
			await repo.seed(
				createIntegrationRecord({
					ownerId: workspaceId,
					channel: "discord",
					subscriberId: undefined,
				}),
			);
			await repo.seed(createIntegrationRecord({ ownerId: "ws_other", channel: "slack" }));

			const result = await repo.listByWorkspace(workspaceId);

			expect(result).toHaveLength(2);
			expect(result.every((i) => i.ownerId === workspaceId)).toBe(true);
		});

		it("should return empty array when workspace has no integrations", async () => {
			const result = await repo.listByWorkspace("ws_no_integs");
			expect(result).toEqual([]);
		});

		it("should not return inactive workspace integrations", async () => {
			const workspaceId = "ws_inactive_integ";
			await repo.seed(createIntegrationRecord({ ownerId: workspaceId, active: false }));

			const result = await repo.listByWorkspace(workspaceId);

			expect(result).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------
// WorkspaceDefaultRepository — listByWorkspace
// ---------------------------------------------------------------------------

describe("WorkspaceDefaultRepository", () => {
	let repo: InMemoryWorkspaceDefaultRepository;

	beforeEach(() => {
		repo = new InMemoryWorkspaceDefaultRepository();
	});

	describe("listByWorkspace", () => {
		it("should return all defaults for a workspace", async () => {
			const workspaceId = "ws_defaults_list";
			await repo.seed(createWorkspaceDefaultRecord({ workspaceId, topicKey: "alerts" }));
			await repo.seed(createWorkspaceDefaultRecord({ workspaceId, topicKey: "marketing" }));

			const result = await repo.listByWorkspace(workspaceId);

			expect(result).toHaveLength(2);
			expect(result.every((d) => d.workspaceId === workspaceId)).toBe(true);
		});

		it("should return empty array when workspace has no defaults", async () => {
			const result = await repo.listByWorkspace("ws_no_defaults");
			expect(result).toEqual([]);
		});

		it("should not include defaults from another workspace", async () => {
			const freshRepo = new InMemoryWorkspaceDefaultRepository();
			await freshRepo.seed(createWorkspaceDefaultRecord({ workspaceId: "ws_a_isolation" }));
			await freshRepo.seed(createWorkspaceDefaultRecord({ workspaceId: "ws_b_isolation" }));

			const result = await freshRepo.listByWorkspace("ws_a_isolation");

			expect(result.every((d) => d.workspaceId === "ws_a_isolation")).toBe(true);
		});

		it("should preserve isMandatory and enabled values", async () => {
			const workspaceId = "ws_flags";
			await repo.seed(
				createWorkspaceDefaultRecord({ workspaceId, isMandatory: true, enabled: false }),
			);

			const result = await repo.listByWorkspace(workspaceId);

			expect(result[0]).toMatchObject({ isMandatory: true, enabled: false });
		});
	});
});
