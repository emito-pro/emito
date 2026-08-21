import type { NotificationItem } from "@emito/js";
import type { NotificationEvent } from "@emito/types";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotifications } from "../src/useNotifications.js";

// ---------------------------------------------------------------------------
// Mock useEmitoClient to return our mock client directly — avoids EmitoProvider
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const listeners = new Map<string, Set<Listener>>();

function clientOn(event: string, listener: Listener) {
	let set = listeners.get(event);
	if (!set) {
		set = new Set();
		listeners.set(event, set);
	}
	set.add(listener);
	return mockClient;
}

function clientOff(event: string, listener: Listener) {
	listeners.get(event)?.delete(listener);
	return mockClient;
}

function emitEvent(event: string, ...args: unknown[]) {
	const set = listeners.get(event);
	if (!set) return;
	for (const fn of set) fn(...args);
}

const mockClient = {
	on: vi.fn(clientOn),
	off: vi.fn(clientOff),
	notifications: {
		list: vi.fn().mockResolvedValue({ items: [], hasMore: false, cursor: undefined }),
	},
	markAsRead: vi.fn().mockResolvedValue(undefined),
	markAsUnread: vi.fn().mockResolvedValue(undefined),
	markAllAsRead: vi.fn().mockResolvedValue(undefined),
	archive: vi.fn().mockResolvedValue(undefined),
	fetchUnreadCount: vi.fn().mockResolvedValue(0),
};

vi.mock("../src/context.js", () => ({
	useEmitoClient: () => mockClient,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
	return {
		id: `ntf_${Math.random().toString(36).slice(2, 8)}`,
		subscriberId: "sub_1",
		event: "order.filled",
		body: "Your order has been filled",
		readAt: null,
		archivedAt: null,
		snoozedUntil: null,
		createdAt: "2026-04-01T00:00:00.000Z",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useNotifications", () => {
	beforeEach(() => {
		listeners.clear();
		vi.clearAllMocks();
		mockClient.on.mockImplementation(clientOn);
		mockClient.off.mockImplementation(clientOff);
		mockClient.notifications.list.mockResolvedValue({
			items: [],
			hasMore: false,
			cursor: undefined,
		});
		mockClient.markAsRead.mockResolvedValue(undefined);
		mockClient.markAsUnread.mockResolvedValue(undefined);
		mockClient.markAllAsRead.mockResolvedValue(undefined);
		mockClient.archive.mockResolvedValue(undefined);
		mockClient.fetchUnreadCount.mockResolvedValue(0);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("initial fetch", () => {
		it("should fetch notifications on mount", async () => {
			const items = [makeNotification({ id: "ntf_1" }), makeNotification({ id: "ntf_2" })];
			mockClient.notifications.list.mockResolvedValue({ items, hasMore: false });

			const { result } = renderHook(() => useNotifications());

			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.notifications).toHaveLength(2);
			expect(result.current.isLoading).toBe(false);
		});

		it("should pass filter params to notifications.list", async () => {
			const { result } = renderHook(() =>
				useNotifications({ status: "unread", category: "alerts", limit: 10 }),
			);

			await act(async () => {
				await Promise.resolve();
			});

			expect(mockClient.notifications.list).toHaveBeenCalledWith(
				expect.objectContaining({ status: "unread", category: "alerts", limit: 10 }),
			);
			expect(result.current.isLoading).toBe(false);
		});

		it("should set isLoading=false when fetch fails", async () => {
			mockClient.notifications.list.mockRejectedValue(new Error("fail"));

			const { result } = renderHook(() => useNotifications());

			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.isLoading).toBe(false);
			expect(result.current.notifications).toHaveLength(0);
		});

		it("should set hasMore from response", async () => {
			mockClient.notifications.list.mockResolvedValue({
				items: [makeNotification()],
				hasMore: true,
			});

			const { result } = renderHook(() => useNotifications());

			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.hasMore).toBe(true);
		});
	});

	describe("real-time WS events", () => {
		it("should prepend notification on WS event", async () => {
			mockClient.notifications.list.mockResolvedValue({
				items: [makeNotification({ id: "ntf_1" })],
				hasMore: false,
			});

			const { result } = renderHook(() => useNotifications());
			await act(async () => {
				await Promise.resolve();
			});

			act(() => {
				emitEvent("notification", {
					notificationId: "ntf_live",
					subscriberId: "sub_1",
					event: "order.shipped",
					body: "Your order has shipped",
					timestamp: new Date(),
				} satisfies NotificationEvent);
			});

			expect(result.current.notifications).toHaveLength(2);
			expect(result.current.notifications[0]!.id).toBe("ntf_live");
		});

		it("should NOT prepend when status filter is 'read'", async () => {
			const { result } = renderHook(() => useNotifications({ status: "read" }));
			await act(async () => {
				await Promise.resolve();
			});

			act(() => {
				emitEvent("notification", {
					notificationId: "ntf_live",
					subscriberId: "sub_1",
					event: "order.shipped",
					body: "Your order has shipped",
					timestamp: new Date(),
				} satisfies NotificationEvent);
			});

			expect(result.current.notifications).toHaveLength(0);
		});

		it("should prepend when status filter is 'unread'", async () => {
			const { result } = renderHook(() => useNotifications({ status: "unread" }));
			await act(async () => {
				await Promise.resolve();
			});

			act(() => {
				emitEvent("notification", {
					notificationId: "ntf_live",
					subscriberId: "sub_1",
					event: "order.shipped",
					body: "Your order has shipped",
					timestamp: new Date(),
				} satisfies NotificationEvent);
			});

			expect(result.current.notifications).toHaveLength(1);
		});
	});

	describe("multi-instance isolation", () => {
		it("should maintain independent state for different filters", async () => {
			mockClient.notifications.list
				.mockResolvedValueOnce({ items: [makeNotification({ id: "ntf_all" })], hasMore: false })
				.mockResolvedValueOnce({ items: [makeNotification({ id: "ntf_unread" })], hasMore: false });

			const { result: resultAll } = renderHook(() => useNotifications());
			const { result: resultUnread } = renderHook(() => useNotifications({ status: "unread" }));

			await act(async () => {
				await Promise.resolve();
			});

			expect(resultAll.current.notifications[0]?.id).toBe("ntf_all");
			expect(resultUnread.current.notifications[0]?.id).toBe("ntf_unread");
		});
	});

	describe("actions", () => {
		it("should optimistically mark as read", async () => {
			const items = [
				makeNotification({ id: "ntf_1", readAt: null }),
				makeNotification({ id: "ntf_2", readAt: null }),
			];
			mockClient.notifications.list.mockResolvedValue({ items, hasMore: false });

			const { result } = renderHook(() => useNotifications());
			await act(async () => {
				await Promise.resolve();
			});

			await act(async () => {
				await result.current.markAsRead("ntf_1");
			});

			expect(result.current.notifications[0]!.readAt).toBeTruthy();
			expect(mockClient.markAsRead).toHaveBeenCalledWith("ntf_1");
		});

		it("should revert markAsRead on failure", async () => {
			const items = [
				makeNotification({ id: "ntf_1", readAt: null }),
				makeNotification({ id: "ntf_2", readAt: null }),
			];
			mockClient.notifications.list.mockResolvedValue({ items, hasMore: false });
			mockClient.markAsRead.mockRejectedValue(new Error("fail"));

			const { result } = renderHook(() => useNotifications());
			await act(async () => {
				await Promise.resolve();
			});

			await act(async () => {
				await result.current.markAsRead("ntf_1");
			});

			expect(result.current.notifications[0]!.readAt).toBeNull();
		});

		it("should optimistically mark as unread", async () => {
			const items = [
				makeNotification({ id: "ntf_1", readAt: "2026-04-01T00:00:00.000Z" }),
				makeNotification({ id: "ntf_2", readAt: "2026-04-01T00:00:00.000Z" }),
			];
			mockClient.notifications.list.mockResolvedValue({ items, hasMore: false });

			const { result } = renderHook(() => useNotifications());
			await act(async () => {
				await Promise.resolve();
			});

			await act(async () => {
				await result.current.markAsUnread("ntf_1");
			});

			expect(result.current.notifications[0]!.readAt).toBeNull();
			expect(mockClient.markAsUnread).toHaveBeenCalledWith("ntf_1");
		});

		it("should call markAllAsRead and update local state", async () => {
			const items = [
				makeNotification({ id: "ntf_1", readAt: null }),
				makeNotification({ id: "ntf_2", readAt: "2026-04-01T00:00:00.000Z" }),
			];
			mockClient.notifications.list.mockResolvedValue({ items, hasMore: false });

			const { result } = renderHook(() => useNotifications());
			await act(async () => {
				await Promise.resolve();
			});

			await act(async () => {
				await result.current.markAllAsRead();
			});

			expect(result.current.notifications.every((n) => n.readAt !== null)).toBe(true);
		});

		it("should remove notification on archive", async () => {
			const items = [makeNotification({ id: "ntf_1" }), makeNotification({ id: "ntf_2" })];
			mockClient.notifications.list.mockResolvedValue({ items, hasMore: false });

			const { result } = renderHook(() => useNotifications());
			await act(async () => {
				await Promise.resolve();
			});

			await act(async () => {
				await result.current.archive("ntf_1");
			});

			expect(result.current.notifications).toHaveLength(1);
			expect(result.current.notifications[0]!.id).toBe("ntf_2");
		});
	});

	describe("fetchMore", () => {
		it("should append items on fetchMore", async () => {
			mockClient.notifications.list
				.mockResolvedValueOnce({
					items: [makeNotification({ id: "ntf_1" })],
					hasMore: true,
					cursor: "cur_1",
				})
				.mockResolvedValueOnce({ items: [makeNotification({ id: "ntf_2" })], hasMore: false });

			const { result } = renderHook(() => useNotifications());
			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.hasMore).toBe(true);

			await act(async () => {
				await result.current.fetchMore();
			});

			expect(result.current.notifications).toHaveLength(2);
			expect(result.current.hasMore).toBe(false);
		});
	});

	describe("cleanup", () => {
		it("should not update state after unmount", async () => {
			let resolveList!: (v: unknown) => void;
			mockClient.notifications.list.mockImplementation(
				() =>
					new Promise((res) => {
						resolveList = res;
					}),
			);

			const { unmount } = renderHook(() => useNotifications());

			unmount();
			resolveList({ items: [makeNotification()], hasMore: false });

			// No error — state update silently skipped
		});
	});
});
