import type { SubscriptionRecord, SubscriptionRepository } from "@emito/core";
import type { Channel } from "@emito/types";
import { and, eq } from "drizzle-orm";
import { emito_subscriptions } from "../schema/subscriptions";
import type { DrizzleDb } from "./db-type";

export class DrizzleSubscriptionRepository implements SubscriptionRepository {
	constructor(private readonly db: DrizzleDb) {}

	async findBySubscriberAndTopic(
		subscriberId: string,
		topicId: string,
	): Promise<SubscriptionRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_subscriptions)
			.where(
				and(
					eq(emito_subscriptions.subscriberId, subscriberId),
					eq(emito_subscriptions.topicId, topicId),
				),
			);
		return rows.map((r) => this.mapRow(r));
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): SubscriptionRecord {
		return {
			id: row.id,
			subscriberId: row.subscriberId,
			topicId: row.topicId,
			channel: row.channel as Channel,
			status: row.status === "opted_in" ? "opted_in" : "opted_out",
			consentMechanism: row.consentMechanism ?? undefined,
			consentIp: row.consentIp ?? undefined,
			consentAt: row.consentAt ?? undefined,
			updatedAt: row.updatedAt,
		};
	}
}
