import type { Channel } from "./channels";

export interface PreferenceRecord {
	subscriberId: string;
	workspaceId?: string;
	topicKey: string;
	channel: Channel;
	enabled: boolean;
}

export interface WorkspaceDefault {
	workspaceId: string;
	topicKey: string;
	channel: Channel;
	enabled: boolean;
	isMandatory: boolean;
}

export type PreferenceTier =
	| "workspace_admin_block"
	| "user_workspace"
	| "workspace_default"
	| "user_global"
	| "system_default";

export interface PreferenceResolutionResult {
	enabled: boolean;
	tier: PreferenceTier;
}
