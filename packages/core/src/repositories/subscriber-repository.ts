import type { Subscriber } from "@emito/types";
import type { RepositoryTx } from "./admin-types";
import type { CreateSubscriberData, CursorFilter, CursorResult } from "./types";

/**
 * The per-collection counts of what a GDPR {@link SubscriberRepository.erase}
 * actually anonymised, returned so the caller's erasure certificate reflects the
 * rows that were truly mutated (never a count of rows merely *observed*).
 *
 * Every field is the number of rows the erase scrubbed of subscriber PII inside its
 * transaction: notification delivery addresses + payload/metadata, inbox item bodies,
 * push tokens, personal chat integrations, preferences, and the dead-letter payloads
 * that mirror the notifications. Consent and suppression rows are intentionally
 * *preserved* (legal/audit retention) and so are not counted here.
 */
export interface SubscriberEraseCounts {
	/** Notification rows whose `deliveryAddress` + `payload` + `metadata` were scrubbed. */
	readonly notifications: number;
	/** Inbox rows whose PII fields (subject/body/data/action labels) were scrubbed. */
	readonly inboxItems: number;
	/** Push-token rows deleted (token + device label are PII). */
	readonly pushTokens: number;
	/** Personal chat integration rows deleted (handle/config are PII). */
	readonly personalIntegrations: number;
	/** Preference rows deleted. */
	readonly preferences: number;
	/** Dead-letter rows whose `payload` (a copy of the notification PII) was scrubbed. */
	readonly deadLetters: number;
}

export interface SubscriberRepository {
	findById(id: string): Promise<Subscriber | null>;
	/**
	 * Resolve many subscribers in a single query.
	 *
	 * The batch counterpart of {@link findById}: used by list endpoints that would
	 * otherwise issue one `findById` per row (an N+1). Returns only the subscribers
	 * that exist — missing/erased ids are simply absent from the result (the caller
	 * maps by id), and the order is unspecified. An empty `ids` array short-circuits
	 * to `[]` without hitting the database.
	 */
	findByIds(ids: readonly string[]): Promise<Subscriber[]>;
	update(id: string, data: Partial<Omit<Subscriber, "id" | "createdAt">>): Promise<Subscriber>;
	list(filter?: CursorFilter): Promise<CursorResult<Subscriber>>;
	create(data: CreateSubscriberData): Promise<Subscriber>;
	/** Insert a subscriber, or update it if one with the same id already exists. */
	upsert(data: CreateSubscriberData): Promise<Subscriber>;
	/**
	 * GDPR-erase a subscriber: anonymise the subscriber row **and cascade** the
	 * anonymisation across every collection linked by `subscriberId`.
	 *
	 * The subscriber row's `email`/`phone`/`metadata` are cleared and `erasedAt`
	 * stamped, and the subscriber's PII is scrubbed from the dependent tables —
	 * notification delivery addresses + payloads, inbox item content, push tokens,
	 * personal integrations, preferences, and the dead-letter payloads that copy the
	 * notification data. Consent and suppression rows are deliberately retained for
	 * legal/audit reasons and are not touched. The whole cascade runs in one unit of
	 * work: when a transaction handle is supplied the writes join the caller's
	 * transaction so an audit failure rolls the *entire* erasure back.
	 *
	 * @param id - The subscriber to erase.
	 * @param tx - The caller's transaction handle, or omitted for an autonomous erase.
	 * @returns The per-collection counts of rows actually anonymised.
	 */
	erase(id: string, tx?: RepositoryTx): Promise<SubscriberEraseCounts>;
}
