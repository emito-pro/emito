import type { NotificationItem, NotificationsApi } from "../api/notifications.js";
import type { NotificationStore } from "./store.js";

/**
 * Optimistic update manager for markAsRead.
 * Applies state change immediately, reverts on server error.
 */
export class OptimisticUpdater {
	constructor(
		private readonly store: NotificationStore,
		private readonly api: NotificationsApi,
	) {}

	/**
	 * Optimistically mark a notification as read.
	 * State is updated immediately. If the server request fails,
	 * the state is reverted to its previous value.
	 */
	async markAsRead(id: string): Promise<void> {
		const notifications = this.store.getNotifications();
		const existing = notifications.find((n) => n.id === id);
		const previousReadAt = existing?.readAt;

		// Optimistic: update state immediately
		this.store.markAsRead(id);

		try {
			await this.api.markAsRead(id);
		} catch (error) {
			// Revert on failure
			this.store.revertMarkAsRead(id, previousReadAt);
			throw error;
		}
	}
}
