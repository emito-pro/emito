import type { HttpClient } from "./http.js";

export interface Subscription {
	slug: string;
	name: string;
	subscribedAt: string;
}

export interface SubscriptionListResult {
	items: Subscription[];
	hasMore: boolean;
}

/**
 * Subscriptions API module — wraps marketing list subscription endpoints.
 */
export class SubscriptionsApi {
	constructor(private readonly http: HttpClient) {}

	async list(): Promise<SubscriptionListResult> {
		return this.http.request<SubscriptionListResult>({
			method: "GET",
			path: "/subscriptions",
		});
	}

	async subscribe(slug: string): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: `/lists/${encodeURIComponent(slug)}/subscribe`,
		});
	}

	async unsubscribe(slug: string): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: `/lists/${encodeURIComponent(slug)}/unsubscribe`,
		});
	}
}
