import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/api/http.js";
import type { NotificationItem, NotificationsApi } from "../src/api/notifications.js";
import { OptimisticUpdater } from "../src/state/optimistic.js";
import { NotificationStore } from "../src/state/store.js";

function makeNotificationItem(overrides: Partial<NotificationItem> = {}): NotificationItem {
	return {
		id: "ntf_test_001",
		subscriberId: "sub_001",
		event: "order.filled",
		body: "Your order has been filled",
		readAt: null,
		archivedAt: null,
		snoozedUntil: null,
		createdAt: "2026-04-01T00:00:00.000Z",
		...overrides,
	};
}

function makeApiMock(): NotificationsApi {
	return {
		list: vi.fn(),
		unreadCount: vi.fn(),
		markAsRead: vi.fn(),
		markAsUnread: vi.fn(),
		archive: vi.fn(),
		unarchive: vi.fn(),
		snooze: vi.fn(),
		markAllAsRead: vi.fn(),
	} as unknown as NotificationsApi;
}

describe("OptimisticUpdater", () => {
	let store: NotificationStore;
	let apiMock: NotificationsApi;
	let updater: OptimisticUpdater;

	beforeEach(() => {
		store = new NotificationStore();
		apiMock = makeApiMock();
		updater = new OptimisticUpdater(store, apiMock);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("markAsRead", () => {
		it("should optimistically mark notification as read before API call resolves", async () => {
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			store.setUnreadCount(1);

			let resolveApi!: () => void;
			(apiMock.markAsRead as ReturnType<typeof vi.fn>).mockImplementation(
				() =>
					new Promise<void>((res) => {
						resolveApi = res;
					}),
			);

			const promise = updater.markAsRead("ntf_1");

			// Assert optimistic state applied BEFORE API resolves
			const n = store.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBeTruthy();
			expect(store.getUnreadCount()).toBe(0);

			resolveApi();
			await promise;
		});

		it("should call API with the correct notification ID", async () => {
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			(apiMock.markAsRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

			await updater.markAsRead("ntf_1");

			expect(apiMock.markAsRead).toHaveBeenCalledWith("ntf_1");
		});

		it("should revert state when API call fails", async () => {
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			store.setUnreadCount(1);
			const apiError = new Error("Server error");
			(apiMock.markAsRead as ReturnType<typeof vi.fn>).mockRejectedValue(apiError);

			await expect(updater.markAsRead("ntf_1")).rejects.toThrow("Server error");

			const n = store.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBeNull();
			expect(store.getUnreadCount()).toBe(1);
		});

		it("should re-throw the API error after reverting", async () => {
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			const serverErr = new Error("Internal Server Error");
			(apiMock.markAsRead as ReturnType<typeof vi.fn>).mockRejectedValue(serverErr);

			await expect(updater.markAsRead("ntf_1")).rejects.toBe(serverErr);
		});

		it("should preserve previously-read state on revert when notification was already read", async () => {
			const previousReadAt = "2026-01-01T00:00:00.000Z";
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: previousReadAt })]);
			store.setUnreadCount(0);
			(apiMock.markAsRead as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));

			await expect(updater.markAsRead("ntf_1")).rejects.toThrow();

			// notification was already read — markAsRead was a no-op on state; no change after revert
			const n = store.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBe(previousReadAt);
		});

		it("should work when notification is not in local state (no-op optimistic)", async () => {
			store.setNotifications([]); // notification not loaded
			(apiMock.markAsRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

			// Should not throw even when notification isn't in state
			await updater.markAsRead("ntf_unknown");
		});
	});
});
