import type { Channel } from "@emito/types";
import type { IntegrationRecord } from "./types";

export interface IntegrationRoutingQuery {
	workspaceId: string;
	subscriberId: string;
	channel: Channel;
	eventType: string;
}

export interface CreateIntegrationData {
	ownerId: string;
	subscriberId?: string;
	name?: string;
	channel: Channel;
	events?: string[];
	config: Record<string, unknown>;
	secretFields?: string[];
}

export interface UpdateIntegrationData {
	name?: string;
	events?: string[];
	config?: Record<string, unknown>;
}

export interface IntegrationRepository {
	findBySubscriberAndChannel(subscriberId: string, channel: Channel): Promise<IntegrationRecord[]>;
	findForRouting(query: IntegrationRoutingQuery): Promise<IntegrationRecord[]>;
	listByWorkspace(workspaceId: string): Promise<IntegrationRecord[]>;
	listBySubscriber(subscriberId: string): Promise<IntegrationRecord[]>;
	findById(id: string): Promise<IntegrationRecord | undefined>;
	create(data: CreateIntegrationData): Promise<IntegrationRecord>;
	update(id: string, data: UpdateIntegrationData): Promise<IntegrationRecord>;
	deactivate(id: string): Promise<void>;
}
