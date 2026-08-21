export type BroadcastStatus = "pending" | "running" | "completed" | "failed";

export interface BroadcastRequest {
	listSlug: string;
	event: string;
	payload: Record<string, unknown>;
	scheduledAt?: Date;
}

export interface BroadcastRecord {
	id: string;
	listSlug: string;
	event: string;
	payload: Record<string, unknown>;
	scheduledAt?: Date;
	status: BroadcastStatus;
	createdAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	memberCount?: number;
	processedCount: number;
}
