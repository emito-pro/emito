/** A push-notification token registered to a subscriber's device. */
export interface PushTokenRecord {
	id: string;
	subscriberId: string;
	token: string;
	platform: string;
	deviceName: string | null;
	active: boolean;
	lastUsedAt: Date | null;
	createdAt: Date;
}

export interface PushTokenRepository {
	deactivateByToken(token: string): Promise<void>;
	/**
	 * List every push token registered to a subscriber, newest-first.
	 *
	 * Backs the subscriber "Channels" tab, which renders the subscriber's
	 * registered devices (active and inactive). Returns `[]` for a subscriber with
	 * no tokens; the order is `createdAt` descending so the freshest device leads.
	 *
	 * **Optional** so existing implementers/doubles that pre-date the admin
	 * surface keep type-checking; the admin endpoints guard on its presence and
	 * degrade to an empty token list when an implementation omits it.
	 */
	listBySubscriber?(subscriberId: string): Promise<PushTokenRecord[]>;
	/**
	 * Deactivate a single push token by its id, scoped to its owning subscriber.
	 *
	 * The "Channels" tab lets an operator revoke one device. Scoping the update
	 * to `(id, subscriberId)` makes a cross-subscriber id a no-op (a `false` return)
	 * rather than silently deactivating another subscriber's token. Returns whether
	 * a matching active/inactive row was updated.
	 *
	 * **Optional** for the same reason as {@link listBySubscriber}.
	 */
	deactivateById?(id: string, subscriberId: string): Promise<boolean>;
}
