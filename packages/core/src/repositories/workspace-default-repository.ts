import type { Channel, WorkspaceDefault } from "@emito/types";

export interface UpsertWorkspaceDefaultData {
	workspaceId: string;
	topicKey: string;
	channel: Channel;
	enabled: boolean;
	isMandatory: boolean;
}

export interface WorkspaceDefaultRepository {
	findByWorkspace(workspaceId: string, topicKey?: string): Promise<WorkspaceDefault[]>;
	listByWorkspace(workspaceId: string): Promise<WorkspaceDefault[]>;
	upsert(data: UpsertWorkspaceDefaultData): Promise<WorkspaceDefault>;
}
