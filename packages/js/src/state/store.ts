import type { NotificationEvent } from "@emito/types";
import type { NotificationItem } from "../api/notifications.js";
import type { TypedEmitter } from "../events.js";

export interface NotificationStoreState {
	notifications: NotificationItem[];
	unreadCount: number;
}

export type StateEventMap = {
	notifications: [notifications: NotificationItem[]];
	unreadCount: [count: number];
};

/**
 * In-memory state store for notification list and unread count.
 * Emits events on the client's event emitter when state changes.
 */
export class NotificationStore {
	private notifications: NotificationItem[] = [];
	private unreadCount = 0;
	// biome-ignore lint/suspicious/noExplicitAny: emitter type varies by client event map
	private emitter: TypedEmitter<any> | null = null;

	/** Bind to a client emitter so state changes fire events */
	bind(emitter: TypedEmitter<StateEventMap>): void {
		this.emitter = emitter;
	}

	getNotifications(): NotificationItem[] {
		return this.notifications;
	}

	getUnreadCount(): number {
		return this.unreadCount;
	}

	/** Replace the full notification list (e.g. after a fetch) */
	setNotifications(items: NotificationItem[]): void {
		this.notifications = items;
		this.emitEvent("notifications", this.notifications);
	}

	/** Set the unread count (e.g. after fetching from server) */
	setUnreadCount(count: number): void {
		this.unreadCount = count;
		this.emitEvent("unreadCount", this.unreadCount);
	}

	/** Prepend a real-time notification to the list and increment unread */
	handleRealtimeNotification(event: NotificationEvent): void {
		const item: NotificationItem = {
			id: event.notificationId,
			subscriberId: event.subscriberId,
			event: event.event,
			category: event.category,
			topic: event.topic,
			subject: event.subject,
			body: event.body,
			avatar: event.avatar,
			actionUrl: event.actionUrl,
			primaryAction: event.primaryAction,
			secondaryAction: event.secondaryAction,
			data: event.data,
			readAt: null,
			archivedAt: null,
			snoozedUntil: null,
			createdAt:
				event.timestamp instanceof Date ? event.timestamp.toISOString() : String(event.timestamp),
		};
		this.notifications = [item, ...this.notifications];
		this.unreadCount += 1;
		this.emitEvent("notifications", this.notifications);
		this.emitEvent("unreadCount", this.unreadCount);
	}

	/** Mark a notification as read in local state */
	markAsRead(id: string): void {
		const notification = this.notifications.find((n) => n.id === id);
		if (!notification) return;
		if (notification.readAt) return; // already read

		this.notifications = this.notifications.map((n) =>
			n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
		);
		this.unreadCount = Math.max(0, this.unreadCount - 1);
		this.emitEvent("notifications", this.notifications);
		this.emitEvent("unreadCount", this.unreadCount);
	}

	/** Remove an archived notification from local state */
	archive(id: string): void {
		const notification = this.notifications.find((n) => n.id === id);
		if (!notification) return;

		this.notifications = this.notifications.filter((n) => n.id !== id);
		if (!notification.readAt) {
			this.unreadCount = Math.max(0, this.unreadCount - 1);
		}
		this.emitEvent("notifications", this.notifications);
		this.emitEvent("unreadCount", this.unreadCount);
	}

	/** Mark a notification as unread in local state */
	markAsUnread(id: string): void {
		const notification = this.notifications.find((n) => n.id === id);
		if (!notification) return;
		if (!notification.readAt) return; // already unread

		this.notifications = this.notifications.map((n) => (n.id === id ? { ...n, readAt: null } : n));
		this.unreadCount += 1;
		this.emitEvent("notifications", this.notifications);
		this.emitEvent("unreadCount", this.unreadCount);
	}

	/** Revert a markAsRead by restoring the previous readAt value */
	revertMarkAsRead(id: string, previousReadAt: string | null | undefined): void {
		const wasUnread = !previousReadAt;
		this.notifications = this.notifications.map((n) =>
			n.id === id ? { ...n, readAt: previousReadAt ?? null } : n,
		);
		if (wasUnread) {
			// It was unread before, we marked it read (decremented), now revert (increment)
		} else {
			// It was already read, markAsRead was a no-op on count
		}
		// Recalculate unread count from source of truth
		this.unreadCount = this.notifications.filter((n) => !n.readAt).length;
		this.emitEvent("notifications", this.notifications);
		this.emitEvent("unreadCount", this.unreadCount);
	}

	/** Mark all as read in local state */
	markAllAsRead(): void {
		const now = new Date().toISOString();
		this.notifications = this.notifications.map((n) => (n.readAt ? n : { ...n, readAt: now }));
		this.unreadCount = 0;
		this.emitEvent("notifications", this.notifications);
		this.emitEvent("unreadCount", this.unreadCount);
	}

	private emitEvent<K extends keyof StateEventMap>(event: K, ...args: StateEventMap[K]): void {
		if (this.emitter) {
			this.emitter.emit(event, ...args);
		}
	}
}
