export type { SubscriberRepository, SubscriberEraseCounts } from "./subscriber-repository";
export type { NotificationRepository } from "./notification-repository";
export type {
	PreferenceRepository,
	PreferenceFilter,
	UpsertPreferenceData,
} from "./preference-repository";
export type {
	WorkspaceDefaultRepository,
	UpsertWorkspaceDefaultData,
} from "./workspace-default-repository";
export type { SuppressionRepository } from "./suppression-repository";
export type { SubscriptionRepository } from "./subscription-repository";
export type { DeadLetterRepository } from "./dead-letter-repository";
export type {
	IntegrationRepository,
	IntegrationRoutingQuery,
	CreateIntegrationData,
	UpdateIntegrationData,
} from "./integration-repository";
export type { InboxRepository } from "./inbox-repository";
export type { PushTokenRecord, PushTokenRepository } from "./push-token-repository";
export type { ConsentRepository } from "./consent-repository";
export type { ListRepository } from "./list-repository";
export type { ListMemberRepository } from "./list-member-repository";

// Admin repositories
export type { AuditLogRepository } from "./audit-log-repository";
export type { AlertRepository } from "./alert-repository";
export type { AlertHistoryRepository } from "./alert-history-repository";
export type { SavedViewRepository } from "./saved-view-repository";
export type { ApiKeyRepository } from "./api-key-repository";
export type { ScheduledSendRepository } from "./scheduled-send-repository";
export type { BroadcastRepository } from "./broadcast-repository";
export type { TemplateOverrideRepository } from "./template-override-repository";

export type {
	ApiPage,
	RepositoryTx,
	// Audit log
	AuditSeverity,
	AuditActorKind,
	AuditLogEntry,
	AuditLogRecord,
	AuditLogFilters,
	// Alerts
	AlertSeverity,
	AlertRecord,
	AlertCreate,
	AlertPatch,
	AlertFilters,
	// Alert history
	AlertHistoryRecord,
	AlertHistoryCreate,
	AlertHistoryFilters,
	// Saved views
	SavedViewScope,
	SavedViewRecord,
	SavedViewCreate,
	SavedViewPatch,
	// API keys
	ApiKeyScope,
	ApiKeyRecord,
	ApiKeyCreate,
	// Scheduled sends
	ScheduledSendStatus,
	ScheduledSendKind,
	ScheduledSendRecord,
	ScheduledSendCreate,
	ScheduledSendFilters,
	// Broadcasts (admin send-records — distinct from the core broadcast service)
	AdminBroadcastStatus,
	BroadcastCounters,
	AdminBroadcastRecord,
	AdminBroadcastCreate,
	AdminBroadcastFilters,
	// Template overrides
	TemplateOverrideChannel,
	TemplateGalleryStatus,
	TemplateOverrideRecord,
	TemplateOverrideCreate,
	TemplateGalleryCell,
} from "./admin-types";

export type {
	NotificationRecord,
	CreateNotificationData,
	UpdateNotificationStatusData,
	SuppressionRecord,
	CreateSuppressionData,
	SubscriptionRecord,
	DeadLetterRecord,
	DeadLetterAttempt,
	CreateDeadLetterData,
	IntegrationRecord,
	InboxRecord,
	CreateInboxData,
	CursorFilter,
	CursorResult,
	NotificationFilter,
	InboxFilter,
	DeadLetterFilter,
	SuppressionFilter,
	SuppressionAdminFilter,
	CreateSubscriberData,
	ConsentRecord,
	CreateConsentData,
	ConsentFilter,
	ListRecord,
	CreateListData,
	UpdateListData,
	ListFilter,
	ListMemberRecord,
	CreateListMemberData,
	ListMemberFilter,
	ListOptinType,
	ListVisibility,
	ListMemberStatus,
} from "./types";
