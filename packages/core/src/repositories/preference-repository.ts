import type { Channel, PreferenceRecord } from "@emito/types";

export interface PreferenceFilter {
	workspaceId?: string | null;
	topicKey?: string;
	channel?: Channel;
}

export interface UpsertPreferenceData {
	subscriberId: string;
	workspaceId?: string | null;
	topicKey: string;
	channel: Channel;
	enabled: boolean;
}

export interface PreferenceRepository {
	findBySubscriber(subscriberId: string, filter?: PreferenceFilter): Promise<PreferenceRecord[]>;
	listBySubscriber(subscriberId: string): Promise<PreferenceRecord[]>;
	upsert(data: UpsertPreferenceData): Promise<PreferenceRecord>;
	reset(subscriberId: string, workspaceId?: string | null): Promise<void>;
	listByWorkspace(workspaceId: string): Promise<PreferenceRecord[]>;
}
