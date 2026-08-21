import type { SubscriptionRepository } from "../subscription-repository";
import type { SubscriptionRecord } from "../types";

export class InMemorySubscriptionRepository implements SubscriptionRepository {
	private store: SubscriptionRecord[] = [];

	async findBySubscriberAndTopic(
		subscriberId: string,
		topicId: string,
	): Promise<SubscriptionRecord[]> {
		return this.store.filter((s) => s.subscriberId === subscriberId && s.topicId === topicId);
	}

	seed(subscription: SubscriptionRecord): void {
		this.store.push(subscription);
	}

	clear(): void {
		this.store = [];
	}
}
