import { describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "../src/api/notifications.js";
import { TypedEmitter } from "../src/events.js";
import { NotificationStore, type StateEventMap } from "../src/state/store.js";

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

function makeEmitter(): TypedEmitter<StateEventMap> {
	return new (class extends TypedEmitter<StateEventMap> {})();
}

describe("NotificationStore", () => {
	describe("getNotifications", () => {
		it("should return empty array initially", () => {
			const store = new NotificationStore();
			expect(store.getNotifications()).toEqual([]);
		});
	});

	describe("getUnreadCount", () => {
		it("should return 0 initially", () => {
			const store = new NotificationStore();
			expect(store.getUnreadCount()).toBe(0);
		});
	});

	describe("setNotifications", () => {
		it("should replace notification list", () => {
			const store = new NotificationStore();
			const items = [makeNotificationItem({ id: "ntf_1" }), makeNotificationItem({ id: "ntf_2" })];

			store.setNotifications(items);

			expect(store.getNotifications()).toHaveLength(2);
		});

		it("should emit notifications event", () => {
			const store = new NotificationStore();
			const emitter = makeEmitter();
			store.bind(emitter);
			const handler = vi.fn();
			emitter.on("notifications", handler);

			const items = [makeNotificationItem()];
			store.setNotifications(items);

			expect(handler).toHaveBeenCalledWith(items);
		});
	});

	describe("setUnreadCount", () => {
		it("should update unread count", () => {
			const store = new NotificationStore();
			store.setUnreadCount(7);
			expect(store.getUnreadCount()).toBe(7);
		});

		it("should emit unreadCount event", () => {
			const store = new NotificationStore();
			const emitter = makeEmitter();
			store.bind(emitter);
			const handler = vi.fn();
			emitter.on("unreadCount", handler);

			store.setUnreadCount(5);

			expect(handler).toHaveBeenCalledWith(5);
		});
	});

	describe("handleRealtimeNotification", () => {
		it("should prepend notification to list", () => {
			const store = new NotificationStore();
			store.setNotifications([makeNotificationItem({ id: "ntf_old" })]);

			store.handleRealtimeNotification({
				notificationId: "ntf_new",
				subscriberId: "sub_001",
				event: "msg.received",
				body: "New message received",
				timestamp: new Date("2026-04-13T10:00:00.000Z"),
			});

			const notifications = store.getNotifications();
			expect(notifications[0]!.id).toBe("ntf_new");
			expect(notifications[1]!.id).toBe("ntf_old");
		});

		it("should increment unread count on real-time notification", () => {
			const store = new NotificationStore();
			store.setUnreadCount(3);

			store.handleRealtimeNotification({
				notificationId: "ntf_rt",
				subscriberId: "sub_001",
				event: "msg.received",
				body: "New message received",
				timestamp: new Date(),
			});

			expect(store.getUnreadCount()).toBe(4);
		});

		it("should emit both notifications and unreadCount events", () => {
			const store = new NotificationStore();
			const emitter = makeEmitter();
			store.bind(emitter);
			const notifHandler = vi.fn();
			const countHandler = vi.fn();
			emitter.on("notifications", notifHandler);
			emitter.on("unreadCount", countHandler);

			store.handleRealtimeNotification({
				notificationId: "ntf_rt",
				subscriberId: "sub_001",
				event: "msg.received",
				body: "New message received",
				data: { key: "value" },
				timestamp: new Date("2026-04-13T10:00:00.000Z"),
			});

			expect(notifHandler).toHaveBeenCalledOnce();
			expect(countHandler).toHaveBeenCalledWith(1);
		});

		it("should set createdAt from timestamp Date object", () => {
			const store = new NotificationStore();
			const ts = new Date("2026-04-13T10:00:00.000Z");

			store.handleRealtimeNotification({
				notificationId: "ntf_rt",
				subscriberId: "sub_001",
				event: "msg.received",
				body: "New message received",
				timestamp: ts,
			});

			expect(store.getNotifications()[0]!.createdAt).toBe(ts.toISOString());
		});
	});

	describe("markAsRead", () => {
		it("should set readAt on the matching notification", () => {
			const store = new NotificationStore();
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);

			store.markAsRead("ntf_1");

			const n = store.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBeTruthy();
		});

		it("should decrement unread count when marking previously unread notification", () => {
			const store = new NotificationStore();
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			store.setUnreadCount(3);

			store.markAsRead("ntf_1");

			expect(store.getUnreadCount()).toBe(2);
		});

		it("should not decrement unread count if notification was already read", () => {
			const store = new NotificationStore();
			store.setNotifications([
				makeNotificationItem({ id: "ntf_1", readAt: "2026-01-01T00:00:00.000Z" }),
			]);
			store.setUnreadCount(2);

			store.markAsRead("ntf_1");

			expect(store.getUnreadCount()).toBe(2);
		});

		it("should emit notifications and unreadCount events", () => {
			const store = new NotificationStore();
			const emitter = makeEmitter();
			store.bind(emitter);
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			const notifHandler = vi.fn();
			const countHandler = vi.fn();
			emitter.on("notifications", notifHandler);
			emitter.on("unreadCount", countHandler);

			store.markAsRead("ntf_1");

			expect(notifHandler).toHaveBeenCalled();
			expect(countHandler).toHaveBeenCalled();
		});

		it("should be a no-op for unknown notification ID", () => {
			const store = new NotificationStore();
			store.setNotifications([makeNotificationItem({ id: "ntf_1" })]);
			store.setUnreadCount(1);

			store.markAsRead("ntf_unknown");

			expect(store.getUnreadCount()).toBe(1);
		});
	});

	describe("archive", () => {
		it("should remove the matching notification from the list", () => {
			const store = new NotificationStore();
			store.setNotifications([
				makeNotificationItem({ id: "ntf_1" }),
				makeNotificationItem({ id: "ntf_2" }),
			]);

			store.archive("ntf_1");

			expect(store.getNotifications().map((n) => n.id)).toEqual(["ntf_2"]);
		});

		it("should decrement unread count when the archived notification was unread", () => {
			const store = new NotificationStore();
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			store.setUnreadCount(2);

			store.archive("ntf_1");

			expect(store.getUnreadCount()).toBe(1);
		});

		it("should not decrement unread count when the archived notification was already read", () => {
			const store = new NotificationStore();
			store.setNotifications([
				makeNotificationItem({ id: "ntf_1", readAt: "2026-01-01T00:00:00.000Z" }),
			]);
			store.setUnreadCount(2);

			store.archive("ntf_1");

			expect(store.getUnreadCount()).toBe(2);
		});

		it("should emit notifications and unreadCount events", () => {
			const store = new NotificationStore();
			const emitter = makeEmitter();
			store.bind(emitter);
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			const notifHandler = vi.fn();
			const countHandler = vi.fn();
			emitter.on("notifications", notifHandler);
			emitter.on("unreadCount", countHandler);

			store.archive("ntf_1");

			expect(notifHandler).toHaveBeenCalled();
			expect(countHandler).toHaveBeenCalled();
		});

		it("should be a no-op for unknown notification ID", () => {
			const store = new NotificationStore();
			store.setNotifications([makeNotificationItem({ id: "ntf_1" })]);
			store.setUnreadCount(1);

			store.archive("ntf_unknown");

			expect(store.getNotifications().map((n) => n.id)).toEqual(["ntf_1"]);
			expect(store.getUnreadCount()).toBe(1);
		});
	});

	describe("markAsUnread", () => {
		it("should clear readAt on the matching notification", () => {
			const store = new NotificationStore();
			store.setNotifications([
				makeNotificationItem({ id: "ntf_1", readAt: "2026-01-01T00:00:00.000Z" }),
			]);

			store.markAsUnread("ntf_1");

			const n = store.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBeNull();
		});

		it("should increment unread count when marking previously read notification", () => {
			const store = new NotificationStore();
			store.setNotifications([
				makeNotificationItem({ id: "ntf_1", readAt: "2026-01-01T00:00:00.000Z" }),
			]);
			store.setUnreadCount(0);

			store.markAsUnread("ntf_1");

			expect(store.getUnreadCount()).toBe(1);
		});

		it("should not increment count if already unread", () => {
			const store = new NotificationStore();
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			store.setUnreadCount(2);

			store.markAsUnread("ntf_1");

			expect(store.getUnreadCount()).toBe(2);
		});
	});

	describe("markAllAsRead", () => {
		it("should set readAt on all unread notifications", () => {
			const store = new NotificationStore();
			store.setNotifications([
				makeNotificationItem({ id: "ntf_1", readAt: null }),
				makeNotificationItem({ id: "ntf_2", readAt: null }),
				makeNotificationItem({ id: "ntf_3", readAt: "2026-01-01T00:00:00.000Z" }),
			]);

			store.markAllAsRead();

			const notifications = store.getNotifications();
			expect(notifications.every((n) => n.readAt !== null)).toBe(true);
		});

		it("should set unread count to 0", () => {
			const store = new NotificationStore();
			store.setNotifications([
				makeNotificationItem({ id: "ntf_1", readAt: null }),
				makeNotificationItem({ id: "ntf_2", readAt: null }),
			]);
			store.setUnreadCount(2);

			store.markAllAsRead();

			expect(store.getUnreadCount()).toBe(0);
		});

		it("should emit events", () => {
			const store = new NotificationStore();
			const emitter = makeEmitter();
			store.bind(emitter);
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			const notifHandler = vi.fn();
			const countHandler = vi.fn();
			emitter.on("notifications", notifHandler);
			emitter.on("unreadCount", countHandler);

			store.markAllAsRead();

			expect(notifHandler).toHaveBeenCalled();
			expect(countHandler).toHaveBeenCalledWith(0);
		});
	});

	describe("revertMarkAsRead", () => {
		it("should restore readAt to previous null value and recalculate unread count", () => {
			const store = new NotificationStore();
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			store.setUnreadCount(1);

			// Simulate markAsRead was called: optimistic update set readAt and decremented count
			store.markAsRead("ntf_1");
			expect(store.getUnreadCount()).toBe(0);

			// Revert
			store.revertMarkAsRead("ntf_1", null);

			const n = store.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBeNull();
			expect(store.getUnreadCount()).toBe(1);
		});

		it("should emit events on revert", () => {
			const store = new NotificationStore();
			const emitter = makeEmitter();
			store.bind(emitter);
			store.setNotifications([makeNotificationItem({ id: "ntf_1", readAt: null })]);
			store.markAsRead("ntf_1");

			const notifHandler = vi.fn();
			const countHandler = vi.fn();
			emitter.on("notifications", notifHandler);
			emitter.on("unreadCount", countHandler);

			store.revertMarkAsRead("ntf_1", null);

			expect(notifHandler).toHaveBeenCalled();
			expect(countHandler).toHaveBeenCalled();
		});
	});

	describe("bind", () => {
		it("should not emit events before binding", () => {
			const store = new NotificationStore();
			const items = [makeNotificationItem()];

			// Should not throw
			store.setNotifications(items);
		});
	});
});
