// createEmito factory
export { createEmito } from "./emito";
export type { Emito, EmitoCoreConfig } from "./emito";

// Typed event emitter
export { createTypedEmitter } from "./events";
export type { EmitoInstanceEvents, TypedEmitter } from "./events";

// Send flow
export { executeSend } from "./send";
export type { SendDeps } from "./send";

// Lifecycle
export { start, stop, healthCheck } from "./lifecycle";
export type { HealthCheckResult, ProviderHealthResult, LifecycleDeps } from "./lifecycle";

// Observability
export { createLogger, resolveLogger } from "./observability/logger";
export type { Logger, CreateLoggerOptions } from "./observability/logger";
export { createMetrics } from "./observability/metrics";
export type { MetricsConfig, EmitoMetrics } from "./observability/metrics";
export {
	createTracer,
	getTracer,
	startSpan,
	withSpan,
	recordSpanEvent,
	setSpanError,
} from "./observability/tracing";
export type { CreateTracerOptions } from "./observability/tracing";

// Template resolver
export { createPassthroughResolver } from "./templates/resolver";
export type { TemplateResolver, RenderedContent, ResolveParams } from "./templates/resolver";

// Repository interfaces
export type {
	SubscriberRepository,
	SubscriberEraseCounts,
	NotificationRepository,
	PreferenceRepository,
	PreferenceFilter,
	UpsertPreferenceData,
	WorkspaceDefaultRepository,
	UpsertWorkspaceDefaultData,
	SuppressionRepository,
	SubscriptionRepository,
	DeadLetterRepository,
	IntegrationRepository,
	IntegrationRoutingQuery,
	CreateIntegrationData,
	UpdateIntegrationData,
	InboxRepository,
	PushTokenRecord,
	PushTokenRepository,
	ConsentRepository,
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
} from "./repositories/index";

export type { ListRepository } from "./repositories/index";
export type { ListMemberRepository } from "./repositories/index";

// Admin repository interfaces
export type {
	AuditLogRepository,
	AlertRepository,
	AlertHistoryRepository,
	SavedViewRepository,
	ApiKeyRepository,
	ScheduledSendRepository,
	BroadcastRepository,
	TemplateOverrideRepository,
} from "./repositories/index";

// Admin public types
export type {
	ApiPage,
	RepositoryTx,
	AuditSeverity,
	AuditActorKind,
	AuditLogEntry,
	AuditLogRecord,
	AuditLogFilters,
	AlertSeverity,
	AlertRecord,
	AlertCreate,
	AlertPatch,
	AlertFilters,
	AlertHistoryRecord,
	AlertHistoryCreate,
	AlertHistoryFilters,
	SavedViewScope,
	SavedViewRecord,
	SavedViewCreate,
	SavedViewPatch,
	ApiKeyScope,
	ApiKeyRecord,
	ApiKeyCreate,
	ScheduledSendStatus,
	ScheduledSendKind,
	ScheduledSendRecord,
	ScheduledSendCreate,
	ScheduledSendFilters,
	AdminBroadcastStatus,
	BroadcastCounters,
	AdminBroadcastRecord,
	AdminBroadcastCreate,
	AdminBroadcastFilters,
	TemplateOverrideChannel,
	TemplateGalleryStatus,
	TemplateOverrideRecord,
	TemplateOverrideCreate,
	TemplateGalleryCell,
} from "./repositories/index";

// List services
export { ListService } from "./lists/index";
export type { ListServiceDeps } from "./lists/index";
export { MembershipService } from "./lists/index";
export type { MembershipServiceDeps, ConfirmEmailSender, TokenSigner } from "./lists/index";
export { ListMemberConfirmAdapter } from "./lists/index";
export type { ListMemberConfirm } from "./lists/index";

// Broadcast service
export { BroadcastService } from "./broadcast/index";
export type { BroadcastServiceDeps } from "./broadcast/index";
export { createBroadcastScheduler } from "./broadcast/index";
export type { BroadcastScheduler, BroadcastSchedulerDeps } from "./broadcast/index";
export type { BroadcastRequest, BroadcastRecord, BroadcastStatus } from "./broadcast/index";

// In-memory repository implementations
export {
	InMemorySubscriberRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemoryWorkspaceDefaultRepository,
	InMemorySuppressionRepository,
	InMemorySubscriptionRepository,
	InMemoryDeadLetterRepository,
	InMemoryIntegrationRepository,
	InMemoryInboxRepository,
	InMemoryPushTokenRepository,
	InMemoryConsentRepository,
	InMemoryListRepository,
	InMemoryListMemberRepository,
	// Admin in-memory repositories
	InMemoryAuditLogRepository,
	InMemoryAlertRepository,
	InMemoryAlertHistoryRepository,
	InMemorySavedViewRepository,
	InMemoryApiKeyRepository,
	InMemoryScheduledSendRepository,
	InMemoryBroadcastRepository,
	InMemoryTemplateOverrideRepository,
} from "./repositories/in-memory/index";

// Redis interfaces
export type { RedisLike, RedisMulti } from "./redis/index";
export { IoRedisAdapter, createRedisAdapter } from "./redis/index";

// Circuit breaker
export {
	createCircuitBreaker,
	DEFAULT_CIRCUIT_BREAKER_CONFIG,
	CIRCUIT_STATE_VALUE,
} from "./circuit-breaker";
export type { CircuitBreaker, CircuitBreakerConfig, CircuitState } from "./circuit-breaker";

// Digest engine
export { createDigestEngine } from "./digest/index";
export type { DigestEngine, DigestEngineConfig, DigestEvent } from "./digest/index";
export { atomicFlush, acquireFlushLock, digestKey, flushLockKey } from "./digest/index";

// Rate limiter
export { createRateLimiter, DEFAULT_RATE_LIMITS } from "./rate-limiter";
export type { RateLimiter, RateLimitResult } from "./rate-limiter";

// Event registry
export { createEventRegistry } from "./event-registry";
export type { EventRegistry } from "./event-registry";

// Consent service
export { createConsentService } from "./consent/index";
export type { ConsentService, ConsentServiceDeps } from "./consent/index";

// Category enforcement
export { enforceCategory } from "./categories/enforcement";
export type { CategoryEnforcementDeps } from "./categories/enforcement";

// Subscriber resolution
export { resolveSubscriber } from "./subscribers/resolver";
export type {
	RecipientOverrides,
	ResolvedSubscriber,
	SubscriberResolverDeps,
} from "./subscribers/resolver";

// Preference resolution
export { resolvePreferences } from "./preferences/resolver";
export type { ResolvePreferencesParams } from "./preferences/resolver";

// Integration routing
export { routeToIntegrations, isChatChannel } from "./preferences/integration-router";
export type {
	IntegrationDeliveryResult,
	RouteToIntegrationsParams,
} from "./preferences/integration-router";

// Dispatch
export { dispatch } from "./dispatch/dispatcher";
export type { DispatchParams, DispatchResult } from "./dispatch/dispatcher";
export {
	executeWithRetry,
	calculateDelay,
	applyJitter,
	shouldRetry,
	getRetryPolicy,
} from "./dispatch/retry";
export type { RetryContext, RetryResult, AttemptEntry } from "./dispatch/retry";
export { createPriorityStrategy } from "./dispatch/strategies/priority";
export {
	createRoundRobinStrategy,
	resetRoundRobinCounters,
} from "./dispatch/strategies/round-robin";
export { createWeightedStrategy } from "./dispatch/strategies/weighted";
export type { DispatchStrategy, StrategyState } from "./dispatch/strategies/types";

// Suppression
export { checkSuppression, addSuppression } from "./suppression/checker";
export type {
	SuppressionCheckParams,
	SuppressionCheckResult,
	AddSuppressionParams,
} from "./suppression/checker";

// Delivery tracking
export {
	isDeliveryStatus,
	canTransition,
	transition,
	transitionStatus,
	getValidTransitions,
} from "./tracking/state-machine";
export type { StatusTransitionParams } from "./tracking/state-machine";

// Mock provider for testing
export { createMockProvider } from "./testing/mock-provider";
export type {
	MockProvider,
	MockProviderOptions,
} from "./testing/mock-provider";

// Re-export all types from @emito/types for backward compatibility
export type {
	Channel,
	DeliveryStatus,
	DeliveryStatusCategory,
	EmitoErrorCode,
	EmitoErrorOptions,
	RetryPolicy,
	RateLimitConfig,
	BrandTheme,
	ObservabilityConfig,
	ChannelConfig,
	EmitoConfig,
	CategoryDefinition,
	EmitoCategories,
	EventDefinition,
	EmitoEvents,
	SendParams,
	ChannelResult,
	SendResult,
	PreferenceRecord,
	WorkspaceDefault,
	PreferenceTier,
	PreferenceResolutionResult,
	DeliveryMetadata,
	DeliveryResult,
	EmailDeliveryParams,
	SmsDeliveryParams,
	PushDeliveryParams,
	InAppDeliveryParams,
	WebhookDeliveryParams,
	SlackDeliveryParams,
	TelegramDeliveryParams,
	DiscordDeliveryParams,
	WhatsAppDeliveryParams,
	WebPushDeliveryParams,
	ChannelDeliveryParams,
	ProviderPlugin,
	Subscriber,
	NotificationEvent,
	EmitoTransport,
	AssertEqual,
} from "@emito/types";

export {
	classifyStatus,
	isTerminal,
	EMITO_ERROR_CODE,
	EmitoError,
	RETRYABLE_CODES,
	ERROR_STATUS_CODES,
	ChannelSchema,
	DeliveryStatusSchema,
	RetryPolicySchema,
	RateLimitConfigSchema,
	BrandThemeSchema,
	ObservabilityConfigSchema,
	ChannelConfigSchema,
	EmitoConfigSchema,
	CategoryDefinitionSchema,
	EventDefinitionSchema,
	SendParamsSchema,
	ChannelResultSchema,
	SendResultSchema,
	PreferenceRecordSchema,
	WorkspaceDefaultSchema,
	ChannelDeliveryParamsSchema,
	DeliveryResultSchema,
	SubscriberSchema,
	EmitoTransportConfigSchema,
} from "@emito/types";
