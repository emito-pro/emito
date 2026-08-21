import type { Channel, DeliveryStatus, ErrorClassification } from "@emito/types";

// --- Pagination types ---

export interface CursorFilter {
	cursor?: string;
	limit?: number;
}

export interface CursorResult<T> {
	items: T[];
	hasMore: boolean;
	cursor?: string;
}

// --- Per-repository filter types ---

export interface NotificationFilter extends CursorFilter {
	status?: string;
	category?: string;
	channel?: string;
	since?: Date;
	until?: Date;
}

export interface InboxFilter extends CursorFilter {
	status?: "unread" | "read" | "archived";
	category?: string;
}

export interface DeadLetterFilter extends CursorFilter {
	resolved?: boolean;
}

export interface SuppressionFilter extends CursorFilter {
	channel?: string;
	includeArchived?: boolean;
}

/**
 * Rich filter set for the Suppression Management admin list.
 *
 * Distinct from {@link SuppressionFilter} (used by the delivery-time
 * single-channel lookup): the admin grid filters across multiple channels,
 * reasons, and providers at once, free-text searches the address, and bounds the
 * result by an inclusive `addedAt` date range. All facets are optional; an empty
 * or omitted facet imposes no constraint. Mirrors the `GET /suppression` admin
 * query parameters.
 */
export interface SuppressionAdminFilter extends CursorFilter {
	/** Free-text needle matched (case-insensitively, substring) against `address`. */
	addressSearch?: string;
	/** Restrict to these reasons (OR-combined); empty/omitted = any reason. */
	reasons?: string[];
	/** Restrict to these channels (OR-combined); empty/omitted = any channel. */
	channels?: string[];
	/** Restrict to these providers (OR-combined); empty/omitted = any provider. */
	providers?: string[];
	/** Inclusive lower bound on `createdAt` (the "added from" filter). */
	addedFrom?: Date;
	/** Inclusive upper bound on `createdAt` (the "added to" filter). */
	addedTo?: Date;
	/** Include archived (re-enabled) rows; defaults to active-only. */
	includeArchived?: boolean;
}

export interface ConsentRecord {
	id: string;
	subscriberId: string;
	category: string;
	topicSlug?: string;
	consented: boolean;
	ipAddress?: string;
	userAgent?: string;
	source?: string;
	createdAt: Date;
}

export interface CreateConsentData {
	subscriberId: string;
	category: string;
	topicSlug?: string;
	consented: boolean;
	ipAddress?: string;
	userAgent?: string;
	source?: string;
}

export interface ConsentFilter extends CursorFilter {
	subscriberId?: string;
	category?: string;
}

export interface CreateSubscriberData {
	id: string;
	email?: string;
	phone?: string;
	lang?: string;
	locale?: string;
	timezone?: string;
	metadata?: Record<string, unknown>;
}

export interface NotificationRecord {
	id: string;
	subscriberId: string;
	workspaceId?: string;
	eventType: string;
	category: string;
	channel: Channel;
	status: DeliveryStatus;
	deliveryAddress?: string;
	provider?: string;
	providerMsgId?: string;
	errorMessage?: string;
	errorClassification?: ErrorClassification;
	attempts: number;
	payload: Record<string, unknown>;
	metadata: Record<string, unknown>;
	idempotencyKey?: string;
	createdAt: Date;
	sentAt?: Date;
	deliveredAt?: Date;
	openedAt?: Date;
	clickedAt?: Date;
	failedAt?: Date;
}

export interface CreateNotificationData {
	id?: string;
	subscriberId: string;
	workspaceId?: string;
	eventType: string;
	category: string;
	channel: Channel;
	status?: DeliveryStatus;
	deliveryAddress?: string;
	payload?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	idempotencyKey?: string;
}

export interface UpdateNotificationStatusData {
	provider?: string;
	providerMsgId?: string;
	errorMessage?: string;
	errorClassification?: ErrorClassification;
	attempts?: number;
	sentAt?: Date;
	deliveredAt?: Date;
	openedAt?: Date;
	clickedAt?: Date;
	failedAt?: Date;
}

export interface SuppressionRecord {
	id: string;
	address: string;
	channel: Channel;
	reason: string;
	provider?: string;
	providerMsgId?: string;
	consecutiveSoft: number;
	createdAt: Date;
	updatedAt: Date;
	archivedAt?: Date;
}

export interface CreateSuppressionData {
	address: string;
	channel: Channel;
	reason: string;
	provider?: string;
	providerMsgId?: string;
}

export interface SubscriptionRecord {
	id: string;
	subscriberId: string;
	topicId: string;
	channel: Channel;
	status: "opted_in" | "opted_out";
	consentMechanism?: string;
	consentIp?: string;
	consentAt?: Date;
	updatedAt: Date;
}

export interface DeadLetterRecord {
	id: string;
	notificationId: string;
	subscriberId: string;
	eventType: string;
	channel: Channel;
	attempts: DeadLetterAttempt[];
	payload: Record<string, unknown>;
	exhaustedAt: Date;
	resolvedAt?: Date;
	resolution?: string;
}

export interface DeadLetterAttempt {
	provider: string;
	timestamp: Date;
	errorCode: string;
	errorMessage: string;
}

export interface CreateDeadLetterData {
	notificationId: string;
	subscriberId: string;
	eventType: string;
	channel: Channel;
	attempts: DeadLetterAttempt[];
	payload: Record<string, unknown>;
}

export interface IntegrationRecord {
	id: string;
	ownerId: string;
	subscriberId?: string;
	name?: string;
	channel: Channel;
	events?: string[];
	config: Record<string, unknown>;
	secretFields?: string[];
	active: boolean;
	createdAt: Date;
}

export interface InboxRecord {
	id: string;
	subscriberId: string;
	workspaceId?: string;
	eventType: string;
	category: string;
	topicKey?: string;
	subject?: string;
	body: string;
	avatar?: string;
	actionUrl?: string;
	primaryActionLabel?: string;
	primaryActionUrl?: string;
	secondaryActionLabel?: string;
	secondaryActionUrl?: string;
	data: Record<string, unknown>;
	readAt?: Date;
	archivedAt?: Date;
	snoozedUntil?: Date;
	createdAt: Date;
}

export interface CreateInboxData {
	subscriberId: string;
	workspaceId?: string;
	eventType: string;
	category: string;
	topicKey?: string;
	subject?: string;
	body: string;
	avatar?: string;
	actionUrl?: string;
	primaryActionLabel?: string;
	primaryActionUrl?: string;
	secondaryActionLabel?: string;
	secondaryActionUrl?: string;
	data?: Record<string, unknown>;
}

// --- List types ---

export type ListOptinType = "single" | "double";
export type ListVisibility = "public" | "private";
export type ListMemberStatus = "unconfirmed" | "confirmed" | "unsubscribed";

export interface ListRecord {
	id: string;
	name: string;
	slug: string;
	description?: string;
	optinType: ListOptinType;
	visibility: ListVisibility;
	categoryId?: string;
	memberCount: number;
	archivedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateListData {
	name: string;
	slug: string;
	description?: string;
	optinType?: ListOptinType;
	visibility?: ListVisibility;
	categoryId?: string;
}

export interface UpdateListData {
	name?: string;
	description?: string;
}

export interface ListFilter extends CursorFilter {
	archived?: boolean;
}

export interface ListMemberRecord {
	id: string;
	subscriberId: string;
	listId: string;
	status: ListMemberStatus;
	source?: string;
	subscribedAt?: Date;
	confirmedAt?: Date;
	unsubscribedAt?: Date;
	createdAt: Date;
}

export interface CreateListMemberData {
	subscriberId: string;
	listId: string;
	source?: string;
}

export interface ListMemberFilter extends CursorFilter {
	status?: string;
}
