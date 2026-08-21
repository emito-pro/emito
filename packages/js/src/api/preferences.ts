import type { Channel, PreferenceRecord } from "@emito/types";
import type { HttpClient } from "./http.js";

export interface PreferencesResult {
	preferences: PreferenceRecord[];
}

export interface PreferenceUpdateParams {
	topicKey: string;
	channel: Channel;
	enabled: boolean;
}

/**
 * Preferences API module — wraps global and workspace-scoped preference endpoints.
 */
export class PreferencesApi {
	constructor(private readonly http: HttpClient) {}

	async get(): Promise<PreferenceRecord[]> {
		const result = await this.http.request<PreferencesResult>({
			method: "GET",
			path: "/preferences",
		});
		return result.preferences;
	}

	async update(params: PreferenceUpdateParams): Promise<PreferenceRecord> {
		return this.http.request<PreferenceRecord>({
			method: "PUT",
			path: "/preferences",
			body: params,
		});
	}

	async reset(): Promise<void> {
		await this.http.request<{ success: boolean }>({
			method: "POST",
			path: "/preferences/reset",
		});
	}

	async getForWorkspace(workspaceId: string): Promise<PreferenceRecord[]> {
		const result = await this.http.request<PreferencesResult>({
			method: "GET",
			path: `/workspace/${encodeURIComponent(workspaceId)}/preferences`,
		});
		return result.preferences;
	}

	async updateForWorkspace(
		workspaceId: string,
		params: PreferenceUpdateParams,
	): Promise<PreferenceRecord> {
		return this.http.request<PreferenceRecord>({
			method: "PUT",
			path: `/workspace/${encodeURIComponent(workspaceId)}/preferences`,
			body: params,
		});
	}
}
