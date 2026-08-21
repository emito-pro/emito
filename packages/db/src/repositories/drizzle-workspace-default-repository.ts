import type { UpsertWorkspaceDefaultData, WorkspaceDefaultRepository } from "@emito/core";
import type { Channel, WorkspaceDefault } from "@emito/types";
import { and, eq } from "drizzle-orm";
import { emito_workspace_defaults } from "../schema/workspace-defaults";
import type { DrizzleDb } from "./db-type";

export class DrizzleWorkspaceDefaultRepository implements WorkspaceDefaultRepository {
	constructor(private readonly db: DrizzleDb) {}

	async findByWorkspace(workspaceId: string, topicKey?: string): Promise<WorkspaceDefault[]> {
		const conditions = [eq(emito_workspace_defaults.workspaceId, workspaceId)];
		if (topicKey) conditions.push(eq(emito_workspace_defaults.topicKey, topicKey));

		const rows = await this.db
			.select()
			.from(emito_workspace_defaults)
			.where(and(...conditions));

		return rows.map((r) => this.mapRow(r));
	}

	async listByWorkspace(workspaceId: string): Promise<WorkspaceDefault[]> {
		return this.findByWorkspace(workspaceId);
	}

	async upsert(data: UpsertWorkspaceDefaultData): Promise<WorkspaceDefault> {
		const [row] = await this.db
			.insert(emito_workspace_defaults)
			.values({
				workspaceId: data.workspaceId,
				topicKey: data.topicKey,
				channel: data.channel,
				enabled: data.enabled,
				isMandatory: data.isMandatory,
			})
			.onConflictDoUpdate({
				target: [
					emito_workspace_defaults.workspaceId,
					emito_workspace_defaults.topicKey,
					emito_workspace_defaults.channel,
				],
				set: { enabled: data.enabled, isMandatory: data.isMandatory },
			})
			.returning();
		return this.mapRow(row);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): WorkspaceDefault {
		return {
			workspaceId: row.workspaceId,
			topicKey: row.topicKey,
			channel: row.channel,
			enabled: row.enabled,
			isMandatory: row.isMandatory,
		};
	}
}
