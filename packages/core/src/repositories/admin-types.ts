/**
 * Shared types for the eight admin repositories.
 *
 * These records mirror the Drizzle tables in `@emito/db` (`emito_audit_log`,
 * `emito_alerts`, `emito_alert_history`, `emito_saved_views`, `emito_api_keys`,
 * `emito_scheduled_sends`, `emito_broadcasts`, `emito_template_overrides`) but live in
 * `@emito/core` so both the in-memory and Drizzle implementations can share one contract.
 *
 * Every paginated list returns {@link ApiPage} — `{ items, hasMore, cursor, total }` —
 * where `total` is the filtered pre-slice count (drives the admin pagination footer).
 * `RepositoryTx` is an opaque transaction handle: `@emito/core` does not depend on Drizzle,
 * so the audit-log `create` accepts `unknown` and the Drizzle impl narrows it internally.
 */

/**
 * Cursor-paginated page envelope shared by every admin repository `list()` method.
 *
 * `items` is the current slice (ordered newest-first), `hasMore` is true when another
 * page exists, `cursor` is the opaque token to fetch the next page (null on the last
 * page), and `total` is the full filtered count before slicing.
 */
export interface ApiPage<T> {
	readonly items: readonly T[];
	readonly hasMore: boolean;
	readonly cursor: string | null;
	readonly total: number;
}

/**
 * Opaque transaction handle threaded through audit-log writes.
 *
 * `@emito/core` cannot depend on Drizzle, so the interface accepts `unknown`; the
 * Drizzle implementation narrows it back to its real transaction executor. In-memory
 * implementations ignore the handle entirely.
 */
export type RepositoryTx = unknown;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Audit log (emito_audit_log)
// ─────────────────────────────────────────────────────────────────────────────

/** Severity of an audited action — drives the high-severity admin filter. */
export type AuditSeverity = "high" | "medium" | "low";

/** Who fired the action: an interactive admin user or an API key. */
export type AuditActorKind = "user" | "api_key";

/**
 * Input for appending one row to the immutable audit log.
 *
 * `beforeState`/`afterState` are optional JSON snapshots; `resourceId` is nullable for
 * bulk operations that span many resources. `metadata` defaults to `{}` when omitted.
 */
export interface AuditLogEntry {
	actorUserId: string;
	actorKind: AuditActorKind;
	action: string;
	resourceType: string;
	resourceId?: string | null;
	severity: AuditSeverity;
	beforeState?: Record<string, unknown> | null;
	afterState?: Record<string, unknown> | null;
	requestId: string;
	ip: string;
	userAgent?: string | null;
	apiKeyId?: string | null;
	metadata?: Record<string, unknown>;
}

/** A persisted audit-log row. Append-only — never updated or deleted. */
export interface AuditLogRecord {
	id: string;
	actorUserId: string;
	actorKind: AuditActorKind;
	action: string;
	resourceType: string;
	resourceId: string | null;
	severity: AuditSeverity;
	beforeState: Record<string, unknown> | null;
	afterState: Record<string, unknown> | null;
	requestId: string;
	ip: string;
	userAgent: string | null;
	apiKeyId: string | null;
	metadata: Record<string, unknown>;
	createdAt: Date;
}

/** Filter facets accepted by {@link AuditLogRepository.list}. */
export interface AuditLogFilters {
	actor?: string;
	resourceType?: string;
	resourceId?: string;
	severity?: AuditSeverity;
	action?: string;
	from?: Date;
	to?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Alert rules (emito_alerts)
// ─────────────────────────────────────────────────────────────────────────────

/** Alert rule severity. */
export type AlertSeverity = "info" | "warning" | "critical";

/** A persisted alert-rule row. */
export interface AlertRecord {
	id: string;
	name: string;
	metric: string;
	condition: Record<string, unknown>;
	severity: AlertSeverity;
	notify: Record<string, unknown>;
	escalation: Record<string, unknown> | null;
	maintenance: Record<string, unknown> | null;
	enabled: boolean;
	lastTriggeredAt: Date | null;
	/** Optimistic-concurrency token: monotonically increases on every update. */
	version: number;
	createdAt: Date;
	updatedAt: Date;
}

/** Input for creating an alert rule. */
export interface AlertCreate {
	name: string;
	metric: string;
	condition: Record<string, unknown>;
	severity: AlertSeverity;
	notify: Record<string, unknown>;
	escalation?: Record<string, unknown> | null;
	maintenance?: Record<string, unknown> | null;
	enabled?: boolean;
}

/** Partial patch for an alert rule. Undefined fields are left untouched. */
export interface AlertPatch {
	name?: string;
	metric?: string;
	condition?: Record<string, unknown>;
	severity?: AlertSeverity;
	notify?: Record<string, unknown>;
	escalation?: Record<string, unknown> | null;
	maintenance?: Record<string, unknown> | null;
	enabled?: boolean;
}

/** Filter facets accepted by {@link AlertRepository.list}. */
export interface AlertFilters {
	enabled?: boolean;
	severity?: AlertSeverity[];
	metric?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Alert history (emito_alert_history)
// ─────────────────────────────────────────────────────────────────────────────

/** One firing of an alert rule. `resolvedAt`/`acknowledgedAt` are null while active. */
export interface AlertHistoryRecord {
	id: string;
	alertId: string;
	triggeredAt: Date;
	resolvedAt: Date | null;
	triggeredValue: number | null;
	acknowledgedAt: Date | null;
	acknowledgedByUserId: string | null;
	notes: string | null;
}

/** Input for recording a new alert firing. */
export interface AlertHistoryCreate {
	alertId: string;
	triggeredAt?: Date;
	triggeredValue?: number | null;
}

/** Filter facets accepted by {@link AlertHistoryRepository.list}. */
export interface AlertHistoryFilters {
	alertId?: string;
	acknowledged?: boolean;
	from?: Date;
	to?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Saved views (emito_saved_views)
// ─────────────────────────────────────────────────────────────────────────────

/** Visibility scope of a saved view. */
export type SavedViewScope = "private" | "team";

/** A persisted saved-view row. */
export interface SavedViewRecord {
	id: string;
	name: string;
	page: string;
	filters: Record<string, unknown>;
	scope: SavedViewScope;
	createdByUserId: string;
	createdAt: Date;
	updatedAt: Date;
}

/** Input for creating a saved view. `scope` defaults to `private`. */
export interface SavedViewCreate {
	name: string;
	page: string;
	filters?: Record<string, unknown>;
	scope?: SavedViewScope;
	createdByUserId: string;
}

/** Partial patch for a saved view. */
export interface SavedViewPatch {
	name?: string;
	filters?: Record<string, unknown>;
	scope?: SavedViewScope;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. API keys (emito_api_keys)
// ─────────────────────────────────────────────────────────────────────────────

/** Permission scope of an admin-issued API key. */
export type ApiKeyScope = "full" | "readonly";

/**
 * A persisted API-key row. The cleartext key is never stored: `keyHash` is the bcrypt
 * digest and `keyPrefix` the first cleartext chars used for a cheap pre-hash lookup.
 */
export interface ApiKeyRecord {
	id: string;
	name: string;
	keyHash: string;
	keyPrefix: string;
	scope: ApiKeyScope;
	createdByUserId: string;
	lastUsedAt: Date | null;
	createdAt: Date;
	revokedAt: Date | null;
}

/** Input for creating an API key. `keyHash` + `keyPrefix` are computed by the caller. */
export interface ApiKeyCreate {
	name: string;
	keyHash: string;
	keyPrefix: string;
	scope: ApiKeyScope;
	createdByUserId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Scheduled sends (emito_scheduled_sends)
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle state of a scheduled send. */
export type ScheduledSendStatus = "pending" | "running" | "complete" | "cancelled";

/** Whether a scheduled send fans out a broadcast or a single per-event send. */
export type ScheduledSendKind = "broadcast" | "event";

/** A persisted scheduled-send row. */
export interface ScheduledSendRecord {
	id: string;
	kind: ScheduledSendKind;
	eventKey: string;
	payload: Record<string, unknown>;
	recipients: Record<string, unknown>;
	scheduledFor: Date;
	timezone: string;
	status: ScheduledSendStatus;
	createdByUserId: string;
	cancelledAt: Date | null;
	cancelledByUserId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** Input for creating a scheduled send. `status` defaults to `pending`. */
export interface ScheduledSendCreate {
	kind: ScheduledSendKind;
	eventKey: string;
	payload?: Record<string, unknown>;
	recipients?: Record<string, unknown>;
	scheduledFor: Date;
	timezone: string;
	createdByUserId: string;
}

/** Filter facets accepted by {@link ScheduledSendRepository.list}. */
export interface ScheduledSendFilters {
	status?: ScheduledSendStatus[];
	from?: Date;
	to?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Broadcasts (emito_broadcasts)
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle state of an executed broadcast. */
export type AdminBroadcastStatus = "scheduled" | "running" | "sent" | "cancelled";

/** Per-outcome delivery counters for a broadcast. */
export interface BroadcastCounters {
	totalRecipients: number;
	sentCount: number;
	deliveredCount: number;
	failedCount: number;
	bouncedCount: number;
	openedCount: number;
	clickedCount: number;
	unsubscribedCount: number;
}

/** A persisted broadcast send-record row, including its lifecycle and counters. */
export interface AdminBroadcastRecord extends BroadcastCounters {
	id: string;
	title: string;
	listId: string;
	eventKey: string;
	payload: Record<string, unknown>;
	status: AdminBroadcastStatus;
	scheduledFor: Date | null;
	startedAt: Date | null;
	completedAt: Date | null;
	createdByUserId: string;
	createdAt: Date;
}

/** Input for creating a broadcast send-record. Counters default to 0. */
export interface AdminBroadcastCreate {
	title: string;
	listId: string;
	eventKey: string;
	payload?: Record<string, unknown>;
	status?: AdminBroadcastStatus;
	scheduledFor?: Date | null;
	/**
	 * The instant the broadcast began sending, or `null`/omitted when it has not
	 * started. An immediate (un-scheduled) create stamps this so the funnel reports
	 * a real send-start; a future-scheduled create leaves it `null` until the
	 * scheduler runs.
	 */
	startedAt?: Date | null;
	totalRecipients?: number;
	createdByUserId: string;
}

/** Filter facets accepted by {@link BroadcastRepository.list}. */
export interface AdminBroadcastFilters {
	listId?: string;
	status?: string[];
	from?: Date;
	to?: Date;
	/** Case-insensitive substring matched against the broadcast title and event key. */
	search?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Template overrides (emito_template_overrides)
// ─────────────────────────────────────────────────────────────────────────────

/** Channel a template override targets. */
export type TemplateOverrideChannel = "email" | "sms" | "push" | "inApp";

/** Editorial status of one (event, channel, locale) cell in the gallery matrix. */
export type TemplateGalleryStatus = "present-custom" | "present-default" | "fallback" | "missing";

/** A persisted, immutable template-override version row. */
export interface TemplateOverrideRecord {
	id: string;
	eventKey: string;
	channel: TemplateOverrideChannel;
	locale: string;
	source: string;
	compiledWarning: string | null;
	version: number;
	createdByUserId: string;
	updatedByUserId: string;
	createdAt: Date;
	updatedAt: Date;
}

/** Input for creating a template override. `version` is auto-bumped by the repository. */
export interface TemplateOverrideCreate {
	eventKey: string;
	channel: TemplateOverrideChannel;
	locale: string;
	source: string;
	compiledWarning?: string | null;
	createdByUserId: string;
	updatedByUserId: string;
}

/** One cell of the template gallery matrix returned by `listGallery()`. */
export interface TemplateGalleryCell {
	eventKey: string;
	channel: string;
	locale: string;
	status: TemplateGalleryStatus;
	updatedAt?: Date;
}
