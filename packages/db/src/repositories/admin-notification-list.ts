import type { Channel, DeliveryStatus, ErrorClassification } from "@emito/types";

/**
 * Filter + row shapes for the cross-workspace admin notification log
 * (`GET /admin/notifications`).
 *
 * These live in `@emito/db` (alongside the Drizzle repository that produces them)
 * rather than in `@emito/core`'s shared `types.ts`: the Activity Log is a
 * admin-only surface, and keeping the multi-value filter vocabulary here
 * avoids widening the storage-shaped {@link NotificationFilter} (single-value,
 * date-cursor) the send pipeline depends on.
 *
 * @module repositories/admin-notification-list
 */

/**
 * Cross-workspace notification-log filters. Every dimension is optional and AND-ed
 * together; the multi-value dimensions match a row when its column is in the set
 * (SQL `IN (...)`). `q` is a free-text needle matched (case-insensitively) against
 * the notification id, event type, and the joined subscriber's email/phone — the
 * exact surface the Activity Log search chip exposes.
 */
export interface AdminNotificationListFilters {
	/** Free-text needle: matched over id, event type, subscriber email + phone. */
	readonly q?: string;
	/** Match when the row's `status` is in this set. */
	readonly status?: ReadonlyArray<string>;
	/** Match when the row's `channel` is in this set. */
	readonly channel?: ReadonlyArray<string>;
	/** Match when the row's `eventType` is in this set. */
	readonly event?: ReadonlyArray<string>;
	/** Match when the row's `category` is in this set. */
	readonly category?: ReadonlyArray<string>;
	/** Match when the row's `provider` is in this set. */
	readonly provider?: ReadonlyArray<string>;
	/** Exact-match the row's `workspaceId`. */
	readonly workspaceId?: string;
	/** Exact-match the row's `subscriberId` (scopes the log to one recipient). */
	readonly subscriberId?: string;
	/** Match when the row's `errorClassification` is in this set. */
	readonly errorType?: ReadonlyArray<string>;
	/** Inclusive lower bound on `createdAt`. */
	readonly from?: Date;
	/** Inclusive upper bound on `createdAt`. */
	readonly to?: Date;
}

/**
 * A cross-workspace notification-log row, enriched with the joined subscriber's
 * email/phone (so the Activity Log grid renders the recipient without a per-row lookup).
 * `workspaceName` is resolved by the endpoint layer from the subscriber metadata —
 * the repository surfaces the raw `subscriberMetadata` bag for it.
 */
export interface AdminNotificationRow {
	readonly id: string;
	readonly subscriberId: string;
	/** Joined from `emito_subscribers.email`; `null` when the subscriber is absent. */
	readonly subscriberEmail: string | null;
	/** Joined from `emito_subscribers.phone`; `null` when absent. */
	readonly subscriberPhone: string | null;
	/** Joined subscriber metadata bag (for the workspace label); `{}` when absent. */
	readonly subscriberMetadata: Record<string, unknown>;
	readonly eventType: string;
	readonly category: string;
	readonly channel: Channel;
	readonly status: DeliveryStatus;
	readonly provider: string | null;
	readonly providerMsgId: string | null;
	readonly workspaceId: string | null;
	readonly attempts: number;
	readonly createdAt: Date;
	readonly sentAt: Date | null;
	readonly deliveredAt: Date | null;
	readonly openedAt: Date | null;
	readonly clickedAt: Date | null;
	readonly errorMessage: string | null;
	readonly errorClassification: ErrorClassification | null;
}
