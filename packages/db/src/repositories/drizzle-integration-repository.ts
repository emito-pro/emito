import type {
	CreateIntegrationData,
	IntegrationRecord,
	IntegrationRepository,
	IntegrationRoutingQuery,
	UpdateIntegrationData,
} from "@emito/core";
import type { Channel } from "@emito/types";
import { and, eq } from "drizzle-orm";
import { emito_integrations } from "../schema/integrations";
import type { DrizzleDb } from "./db-type";

export class DrizzleIntegrationRepository implements IntegrationRepository {
	constructor(private readonly db: DrizzleDb) {}

	async findBySubscriberAndChannel(
		subscriberId: string,
		channel: Channel,
	): Promise<IntegrationRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_integrations)
			.where(
				and(
					eq(emito_integrations.subscriberId, subscriberId),
					eq(emito_integrations.channel, channel),
					eq(emito_integrations.active, true),
				),
			);
		return rows.map((r) => this.mapRow(r));
	}

	async findForRouting(query: IntegrationRoutingQuery): Promise<IntegrationRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_integrations)
			.where(
				and(
					eq(emito_integrations.ownerId, query.workspaceId),
					eq(emito_integrations.channel, query.channel),
					eq(emito_integrations.active, true),
				),
			);

		return rows
			.filter((r) => {
				if (r.subscriberId != null && r.subscriberId !== query.subscriberId) return false;
				if (r.events != null && !r.events.includes(query.eventType)) return false;
				return true;
			})
			.map((r) => this.mapRow(r));
	}

	async listByWorkspace(workspaceId: string): Promise<IntegrationRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_integrations)
			.where(and(eq(emito_integrations.ownerId, workspaceId), eq(emito_integrations.active, true)));
		return rows.map((r) => this.mapRow(r));
	}

	async listBySubscriber(subscriberId: string): Promise<IntegrationRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_integrations)
			.where(
				and(eq(emito_integrations.subscriberId, subscriberId), eq(emito_integrations.active, true)),
			);
		return rows.map((r) => this.mapRow(r));
	}

	async findById(id: string): Promise<IntegrationRecord | undefined> {
		const [row] = await this.db
			.select()
			.from(emito_integrations)
			.where(eq(emito_integrations.id, id));
		return row ? this.mapRow(row) : undefined;
	}

	async create(data: CreateIntegrationData): Promise<IntegrationRecord> {
		const [row] = await this.db
			.insert(emito_integrations)
			.values({
				ownerId: data.ownerId,
				subscriberId: data.subscriberId,
				name: data.name,
				channel: data.channel,
				events: data.events,
				config: data.config,
				secretFields: data.secretFields,
			})
			.returning();
		return this.mapRow(row);
	}

	async update(id: string, data: UpdateIntegrationData): Promise<IntegrationRecord> {
		const updates: Record<string, unknown> = {};
		if (data.name !== undefined) updates.name = data.name;
		if (data.events !== undefined) updates.events = data.events;
		if (data.config !== undefined) updates.config = data.config;

		const [row] = await this.db
			.update(emito_integrations)
			.set(updates)
			.where(eq(emito_integrations.id, id))
			.returning();
		return this.mapRow(row);
	}

	async deactivate(id: string): Promise<void> {
		await this.db
			.update(emito_integrations)
			.set({ active: false })
			.where(eq(emito_integrations.id, id));
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): IntegrationRecord {
		return {
			id: row.id,
			ownerId: row.ownerId,
			subscriberId: row.subscriberId ?? undefined,
			name: row.name ?? undefined,
			channel: row.channel,
			events: row.events ?? undefined,
			config: (row.config as Record<string, unknown>) ?? {},
			secretFields: row.secretFields ?? undefined,
			active: row.active,
			createdAt: row.createdAt,
		};
	}
}
