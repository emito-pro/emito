import type { PreferenceFilter, PreferenceRepository, UpsertPreferenceData } from "@emito/core";
import type { Channel, PreferenceRecord } from "@emito/types";
import { and, eq, isNull } from "drizzle-orm";
import { emito_preferences } from "../schema/preferences";
import type { DrizzleDb } from "./db-type";

export class DrizzlePreferenceRepository implements PreferenceRepository {
	constructor(private readonly db: DrizzleDb) {}

	async findBySubscriber(
		subscriberId: string,
		filter?: PreferenceFilter,
	): Promise<PreferenceRecord[]> {
		const conditions = [eq(emito_preferences.subscriberId, subscriberId)];

		if (filter?.workspaceId !== undefined) {
			if (filter.workspaceId === null) {
				conditions.push(isNull(emito_preferences.workspaceId));
			} else {
				conditions.push(eq(emito_preferences.workspaceId, filter.workspaceId));
			}
		}
		if (filter?.topicKey) conditions.push(eq(emito_preferences.topicKey, filter.topicKey));
		if (filter?.channel) conditions.push(eq(emito_preferences.channel, filter.channel));

		const rows = await this.db
			.select()
			.from(emito_preferences)
			.where(and(...conditions));

		return rows.map((r) => this.mapRow(r));
	}

	async listBySubscriber(subscriberId: string): Promise<PreferenceRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_preferences)
			.where(eq(emito_preferences.subscriberId, subscriberId));

		return rows.map((r) => this.mapRow(r));
	}

	async upsert(data: UpsertPreferenceData): Promise<PreferenceRecord> {
		const [row] = await this.db
			.insert(emito_preferences)
			.values({
				subscriberId: data.subscriberId,
				workspaceId: data.workspaceId === null ? undefined : data.workspaceId,
				topicKey: data.topicKey,
				channel: data.channel,
				enabled: data.enabled,
			})
			.onConflictDoUpdate({
				target: [
					emito_preferences.subscriberId,
					emito_preferences.workspaceId,
					emito_preferences.topicKey,
					emito_preferences.channel,
				],
				set: { enabled: data.enabled },
			})
			.returning();
		return this.mapRow(row);
	}

	async reset(subscriberId: string, workspaceId?: string | null): Promise<void> {
		const conditions = [eq(emito_preferences.subscriberId, subscriberId)];
		if (workspaceId === null) {
			conditions.push(isNull(emito_preferences.workspaceId));
		} else if (workspaceId !== undefined) {
			conditions.push(eq(emito_preferences.workspaceId, workspaceId));
		}
		await this.db.delete(emito_preferences).where(and(...conditions));
	}

	async listByWorkspace(workspaceId: string): Promise<PreferenceRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_preferences)
			.where(eq(emito_preferences.workspaceId, workspaceId));
		return rows.map((r) => this.mapRow(r));
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): PreferenceRecord {
		return {
			subscriberId: row.subscriberId,
			workspaceId: row.workspaceId ?? undefined,
			topicKey: row.topicKey,
			channel: row.channel,
			enabled: row.enabled,
		};
	}
}
