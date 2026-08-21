import type { PushTokenRecord, PushTokenRepository } from "@emito/core";
import { and, desc, eq } from "drizzle-orm";
import { emito_push_tokens } from "../schema/push-tokens";
import type { DrizzleDb } from "./db-type";

export class DrizzlePushTokenRepository implements PushTokenRepository {
	constructor(private readonly db: DrizzleDb) {}

	async deactivateByToken(token: string): Promise<void> {
		await this.db
			.update(emito_push_tokens)
			.set({ active: false })
			.where(eq(emito_push_tokens.token, token));
	}

	/**
	 * List a subscriber's push tokens, newest-first.
	 *
	 * Ordered by `createdAt` descending so the "Channels" tab leads with the
	 * freshest device. Returns both active and inactive tokens (the tab shows
	 * revoked devices too); an unknown subscriber yields `[]`.
	 */
	async listBySubscriber(subscriberId: string): Promise<PushTokenRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_push_tokens)
			.where(eq(emito_push_tokens.subscriberId, subscriberId))
			.orderBy(desc(emito_push_tokens.createdAt));
		return rows.map((r) => this.mapRow(r));
	}

	/**
	 * Deactivate one token by id, scoped to its owning subscriber.
	 *
	 * The `(id, subscriberId)` predicate makes a cross-subscriber id a no-op (`false`)
	 * rather than touching another subscriber's device. Returns whether a row matched.
	 */
	async deactivateById(id: string, subscriberId: string): Promise<boolean> {
		const rows = await this.db
			.update(emito_push_tokens)
			.set({ active: false })
			.where(and(eq(emito_push_tokens.id, id), eq(emito_push_tokens.subscriberId, subscriberId)))
			.returning({ id: emito_push_tokens.id });
		return rows.length > 0;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): PushTokenRecord {
		return {
			id: row.id,
			subscriberId: row.subscriberId,
			token: row.token,
			platform: row.platform,
			deviceName: row.deviceName ?? null,
			active: row.active ?? false,
			lastUsedAt: row.lastUsedAt ?? null,
			createdAt: row.createdAt,
		};
	}
}
