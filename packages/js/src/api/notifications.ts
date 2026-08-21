import type { InAppAction } from "@emito/types";
import type { HttpClient } from "./http.js";

export interface NotificationItem {
	id: string;
	subscriberId: string;
	event: string;
	category?: string;
	topic?: string;
	subject?: string;
	body: string;
	avatar?: string;
	actionUrl?: string;
	primaryAction?: InAppAction;
	secondaryAction?: InAppAction;
	data?: Record<string, unknown>;
	readAt?: string | null;
	archivedAt?: string | null;
	snoozedUntil?: string | null;
	createdAt: string;
}

export interface NotificationListParams {
	cursor?: string;
	limit?: number;
	status?: string;
	category?: string;
}

export interface NotificationListResult {
	items: NotificationItem[];
	hasMore: boolean;
	cursor?: string;
}

export interface UnreadCountResult {
	count: number;
}

/**
 * Notifications API module — wraps all subscriber notification endpoints.
 */
export class NotificationsApi {
	constructor(private readonly http: HttpClient) {}

	async list(params?: NotificationListParams): Promise<NotificationListResult> {
		return this.http.request<NotificationListResult>({
			method: "GET",
			path: "/notifications",
			query: params
				? {
						cursor: params.cursor,
						limit: params.limit,
						status: params.status,
						category: params.category,
					}
				: undefined,
		});
	}

	async unreadCount(): Promise<number> {
		const result = await this.http.request<UnreadCountResult>({
			method: "GET",
			path: "/notifications/unread/count",
		});
		return result.count;
	}

	async markAsRead(id: string): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: `/notifications/${encodeURIComponent(id)}/read`,
		});
	}

	async markAsUnread(id: string): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: `/notifications/${encodeURIComponent(id)}/unread`,
		});
	}

	async archive(id: string): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: `/notifications/${encodeURIComponent(id)}/archive`,
		});
	}

	async unarchive(id: string): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: `/notifications/${encodeURIComponent(id)}/unarchive`,
		});
	}

	async snooze(id: string, until: Date): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: `/notifications/${encodeURIComponent(id)}/snooze`,
			body: { until: until.toISOString() },
		});
	}

	async markAllAsRead(): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: "/notifications/read-all",
		});
	}
}
