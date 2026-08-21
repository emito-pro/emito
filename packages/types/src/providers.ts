import type { Channel } from "./channels";
import type { ErrorClassification } from "./errors";

export interface DeliveryMetadata {
	notificationId: string;
	subscriberId: string;
	eventType: string;
}

export interface DeliveryResult {
	success: boolean;
	providerMessageId?: string;
	error?: string;
	errorClassification?: ErrorClassification;
	invalidTokens?: string[];
}

export interface EmailDeliveryParams {
	channel: "email";
	to: string;
	subject: string;
	html: string;
	text: string;
	replyTo?: string;
	metadata: DeliveryMetadata;
}

export interface SmsDeliveryParams {
	channel: "sms";
	to: string;
	body: string;
	metadata: DeliveryMetadata;
}

export interface PushDeliveryParams {
	channel: "push";
	tokens: string[];
	title: string;
	body: string;
	data?: Record<string, string>;
	providerOverrides?: Record<string, unknown>;
	metadata: DeliveryMetadata;
}

export interface SlackDeliveryParams {
	channel: "slack";
	webhookUrl: string;
	blocks: unknown[];
	text: string;
	metadata: DeliveryMetadata;
}

export interface TelegramDeliveryParams {
	channel: "telegram";
	botToken: string;
	chatId: string;
	html: string;
	metadata: DeliveryMetadata;
}

export interface DiscordDeliveryParams {
	channel: "discord";
	webhookUrl: string;
	content: string;
	embeds?: unknown[];
	metadata: DeliveryMetadata;
}

export interface InAppDeliveryParams {
	channel: "inApp";
	subscriberId: string;
	title: string;
	body: string;
	data?: Record<string, unknown>;
	metadata: DeliveryMetadata;
}

export interface WebhookDeliveryParams {
	channel: "webhook";
	url: string;
	payload: Record<string, unknown>;
	headers?: Record<string, string>;
	metadata: DeliveryMetadata;
}

export interface WhatsAppDeliveryParams {
	channel: "whatsapp";
	to: string;
	templateName: string;
	templateParams: Record<string, string>;
	metadata: DeliveryMetadata;
}

export interface WebPushDeliveryParams {
	channel: "webPush";
	subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
	title: string;
	body: string;
	data?: Record<string, unknown>;
	metadata: DeliveryMetadata;
}

export type ChannelDeliveryParams =
	| EmailDeliveryParams
	| SmsDeliveryParams
	| PushDeliveryParams
	| InAppDeliveryParams
	| WebhookDeliveryParams
	| SlackDeliveryParams
	| TelegramDeliveryParams
	| DiscordDeliveryParams
	| WhatsAppDeliveryParams
	| WebPushDeliveryParams;

export interface ProviderPlugin {
	name: string;
	channel: Channel;
	deliver(params: ChannelDeliveryParams): Promise<DeliveryResult>;
	healthCheck(): Promise<boolean>;
}
