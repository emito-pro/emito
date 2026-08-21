import type { SubscriptionRecord } from "./types";

export interface SubscriptionRepository {
	findBySubscriberAndTopic(subscriberId: string, topicId: string): Promise<SubscriptionRecord[]>;
}
