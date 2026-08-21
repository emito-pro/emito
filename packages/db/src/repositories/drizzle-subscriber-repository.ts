import type {
	CreateSubscriberData,
	CursorFilter,
	CursorResult,
	RepositoryTx,
	SubscriberEraseCounts,
	SubscriberRepository,
} from "@emito/core";
import type { Subscriber } from "@emito/types";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { emito_dead_letters } from "../schema/dead-letters";
import { emito_inbox } from "../schema/inbox";
import { emito_integrations } from "../schema/integrations";
import { emito_notifications } from "../schema/notifications";
import { emito_preferences } from "../schema/preferences";
import { emito_push_tokens } from "../schema/push-tokens";
import { emito_subscribers } from "../schema/subscribers";
import type { DrizzleDb } from "./db-type";
import { decodeCursorDate, normalizeLimit, toCursorResult } from "./pagination";

export class DrizzleSubscriberRepository implements SubscriberRepository {
	constructor(private readonly db: DrizzleDb) {}

	async findById(id: string): Promise<Subscriber | null> {
		const [row] = await this.db
			.select()
			.from(emito_subscribers)
			.where(eq(emito_subscribers.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	/**
	 * Resolve many subscribers in one `WHERE id IN (…)` query.
	 *
	 * The batch path that lets list endpoints enrich a whole page of rows with their
	 * subscriber in a single round-trip instead of one lookup per row. An empty input
	 * short-circuits to `[]` (a `WHERE id IN ()` is invalid SQL); missing ids are
	 * simply absent from the result and the row order is the database's.
	 */
	async findByIds(ids: readonly string[]): Promise<Subscriber[]> {
		if (ids.length === 0) return [];
		const rows = await this.db
			.select()
			.from(emito_subscribers)
			.where(inArray(emito_subscribers.id, [...ids]));
		return rows.map((r) => this.mapRow(r));
	}

	async update(
		id: string,
		data: Partial<Omit<Subscriber, "id" | "createdAt">>,
	): Promise<Subscriber> {
		const [row] = await this.db
			.update(emito_subscribers)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(emito_subscribers.id, id))
			.returning();
		if (!row) throw new Error(`Subscriber not found: ${id}`);
		return this.mapRow(row);
	}

	async list(filter?: CursorFilter): Promise<CursorResult<Subscriber>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [isNull(emito_subscribers.erasedAt)];
		if (cursorDate) conditions.push(lt(emito_subscribers.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_subscribers)
			.where(and(...conditions))
			.orderBy(desc(emito_subscribers.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	async create(data: CreateSubscriberData): Promise<Subscriber> {
		const [row] = await this.db
			.insert(emito_subscribers)
			.values({
				id: data.id,
				email: data.email,
				phone: data.phone,
				lang: data.lang ?? "en",
				locale: data.locale,
				timezone: data.timezone,
				metadata: data.metadata ?? {},
			})
			.returning();
		return this.mapRow(row);
	}

	async upsert(data: CreateSubscriberData): Promise<Subscriber> {
		const [row] = await this.db
			.insert(emito_subscribers)
			.values({
				id: data.id,
				email: data.email,
				phone: data.phone,
				lang: data.lang ?? "en",
				locale: data.locale,
				timezone: data.timezone,
				metadata: data.metadata ?? {},
			})
			.onConflictDoUpdate({
				target: emito_subscribers.id,
				set: {
					email: data.email,
					phone: data.phone,
					lang: data.lang,
					locale: data.locale,
					timezone: data.timezone,
					metadata: data.metadata,
					updatedAt: new Date(),
				},
			})
			.returning();
		return this.mapRow(row);
	}

	/**
	 * GDPR-erase a subscriber and cascade the anonymisation across every collection
	 * linked by `subscriberId`.
	 *
	 * The cascade runs through the caller's transaction handle when supplied (so the
	 * whole erasure — including the caller's audit write — commits or rolls back as a
	 * unit). Each dependent table is mutated to remove the subscriber's PII and the
	 * count of affected rows is captured from `.returning()` so the caller's erasure
	 * certificate reports what was *actually* scrubbed:
	 *
	 *  - **notifications** — `deliveryAddress` (recipient email/phone) nulled and
	 *    `payload`/`metadata` reset to `{}` (they carry order/event PII).
	 *  - **inbox** — `subject`/`body`/`avatar`/action labels+urls cleared and `data`
	 *    reset to `{}` (the rendered message body is PII).
	 *  - **dead letters** — `payload` reset to `{}` (a verbatim copy of the
	 *    notification payload).
	 *  - **push tokens / personal integrations / preferences** — deleted outright
	 *    (the rows are entirely subscriber-scoped PII with no audit value).
	 *
	 * Consent and suppression rows are **not** touched — they are retained for legal /
	 * compliance reasons and are reported under the certificate's `preserved` block.
	 * Finally the subscriber row itself is anonymised (`email`/`phone`/`metadata`
	 * cleared, `erasedAt` stamped).
	 *
	 * @param id - The subscriber to erase.
	 * @param tx - The caller's transaction handle, or omitted for an autonomous erase.
	 * @returns The per-collection counts of rows actually anonymised.
	 */
	async erase(id: string, tx?: RepositoryTx): Promise<SubscriberEraseCounts> {
		const executor = (tx as DrizzleDb | undefined) ?? this.db;

		const notifications = await executor
			.update(emito_notifications)
			.set({ deliveryAddress: null, payload: {}, metadata: {} })
			.where(eq(emito_notifications.subscriberId, id))
			.returning({ id: emito_notifications.id });

		const inboxItems = await executor
			.update(emito_inbox)
			.set({
				subject: null,
				body: "[ERASED]",
				avatar: null,
				actionUrl: null,
				primaryActionLabel: null,
				primaryActionUrl: null,
				secondaryActionLabel: null,
				secondaryActionUrl: null,
				data: {},
			})
			.where(eq(emito_inbox.subscriberId, id))
			.returning({ id: emito_inbox.id });

		const deadLetters = await executor
			.update(emito_dead_letters)
			.set({ payload: {} })
			.where(eq(emito_dead_letters.subscriberId, id))
			.returning({ id: emito_dead_letters.id });

		const pushTokens = await executor
			.delete(emito_push_tokens)
			.where(eq(emito_push_tokens.subscriberId, id))
			.returning({ id: emito_push_tokens.id });

		const personalIntegrations = await executor
			.delete(emito_integrations)
			.where(eq(emito_integrations.subscriberId, id))
			.returning({ id: emito_integrations.id });

		const preferences = await executor
			.delete(emito_preferences)
			.where(eq(emito_preferences.subscriberId, id))
			.returning({ id: emito_preferences.id });

		await executor
			.update(emito_subscribers)
			.set({
				email: null,
				phone: null,
				metadata: {},
				erasedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(emito_subscribers.id, id));

		return {
			notifications: notifications.length,
			inboxItems: inboxItems.length,
			pushTokens: pushTokens.length,
			personalIntegrations: personalIntegrations.length,
			preferences: preferences.length,
			deadLetters: deadLetters.length,
		};
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): Subscriber {
		return {
			id: row.id,
			email: row.email ?? undefined,
			phone: row.phone ?? undefined,
			lang: row.lang ?? undefined,
			locale: row.locale ?? undefined,
			timezone: row.timezone ?? undefined,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			globallyUnsubscribed: row.globallyUnsubscribed ?? false,
			erasedAt: row.erasedAt ?? undefined,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}
