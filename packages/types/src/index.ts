export type { AssertEqual } from "./type-utils";

export type { Logger } from "./logger";

export type { ResolveSubscriberId } from "./auth";

export type { Channel } from "./channels";

export type {
	DeliveryStatus,
	DeliveryStatusCategory,
} from "./status";
export { classifyStatus, isTerminal } from "./status";

export type {
	EmitoErrorCode,
	EmitoErrorOptions,
	ErrorClassification,
} from "./errors";
export {
	EMITO_ERROR_CODE,
	EmitoError,
	RETRYABLE_CODES,
	RETRYABLE_RECORD,
	SUPPRESSABLE_ERROR_CODES,
	SUPPRESSABLE_RECORD,
	ERROR_STATUS_CODES,
} from "./errors";

export type {
	RetryPolicy,
	RateLimitConfig,
	BrandTheme,
	ObservabilityConfig,
	ChannelConfig,
	EmitoConfig,
} from "./config";

export type {
	CategoryDefinition,
	EmitoCategories,
	EventDefinition,
	EmitoEvents,
} from "./events";

export type {
	SendParams,
	ChannelResult,
	SendResult,
} from "./delivery";

export type {
	PreferenceRecord,
	WorkspaceDefault,
	PreferenceTier,
	PreferenceResolutionResult,
} from "./preferences";

export type {
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
} from "./providers";

export type {
	EmailContent,
	SmsContent,
	PushContent,
	InAppAction,
	InAppContent,
	SlackContent,
	TelegramContent,
	DiscordContent,
	RenderContext,
	EventTemplate,
} from "./templates";

export type { Subscriber } from "./subscribers";

export type {
	WelcomePayload,
	PasswordResetPayload,
	EmailVerificationPayload,
	LoginNewDevicePayload,
	PasswordChangedPayload,
	TwoFaEnabledPayload,
	SecurityAlertPayload,
	ApiKeyCreatedPayload,
	ApiKeyExpiringPayload,
	TeamInvitationPayload,
	TeamMemberJoinedPayload,
	TeamRoleChangedPayload,
	PaymentSucceededPayload,
	PaymentFailedPayload,
	TrialExpiringPayload,
	MaintenancePayload,
	IncidentPayload,
	ResolvedPayload,
	OrderFillPayload,
	PriceAlertPayload,
} from "./payloads";

export type {
	NotificationEvent,
	EmitoTransport,
} from "./transport";

export {
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
	EmailContentSchema,
	SmsContentSchema,
	PushContentSchema,
	InAppActionSchema,
	InAppContentSchema,
	SlackContentSchema,
	TelegramContentSchema,
	DiscordContentSchema,
} from "./schemas/index";
