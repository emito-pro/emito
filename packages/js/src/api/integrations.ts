import type { Channel } from "@emito/types";
import type { HttpClient } from "./http.js";

export interface Integration {
	id: string;
	subscriberId: string;
	channel: Channel;
	name: string;
	events: string[];
	config: Record<string, unknown>;
	active: boolean;
	createdAt: string;
}

export interface IntegrationListResult {
	items: Integration[];
	hasMore: boolean;
}

export interface IntegrationCreateParams {
	channel: Channel;
	name: string;
	events: string[];
	config: Record<string, unknown>;
}

export interface IntegrationUpdateParams {
	name?: string;
	events?: string[];
	config?: Record<string, unknown>;
}

/**
 * Integrations API module — wraps personal integration endpoints.
 */
export class IntegrationsApi {
	constructor(private readonly http: HttpClient) {}

	async list(): Promise<IntegrationListResult> {
		return this.http.request<IntegrationListResult>({
			method: "GET",
			path: "/integrations",
		});
	}

	async create(params: IntegrationCreateParams): Promise<Integration> {
		return this.http.request<Integration>({
			method: "POST",
			path: "/integrations",
			body: params,
		});
	}

	async update(id: string, params: IntegrationUpdateParams): Promise<Integration> {
		return this.http.request<Integration>({
			method: "PUT",
			path: `/integrations/${encodeURIComponent(id)}`,
			body: params,
		});
	}

	async deactivate(id: string): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: `/integrations/${encodeURIComponent(id)}/deactivate`,
		});
	}
}
