import { z } from "zod";

const DeliveryMetadataSchema = z.object({
	notificationId: z.string().min(1),
	subscriberId: z.string().min(1),
	eventType: z.string().min(1),
});

const EmailDeliveryParamsSchema = z.object({
	channel: z.literal("email"),
	to: z.string().email(),
	subject: z.string(),
	html: z.string(),
	text: z.string(),
	replyTo: z.string().email().optional(),
	metadata: DeliveryMetadataSchema,
});

const SmsDeliveryParamsSchema = z.object({
	channel: z.literal("sms"),
	to: z.string().min(1),
	body: z.string(),
	metadata: DeliveryMetadataSchema,
});

const PushDeliveryParamsSchema = z.object({
	channel: z.literal("push"),
	tokens: z.array(z.string()),
	title: z.string(),
	body: z.string(),
	data: z.record(z.string()).optional(),
	providerOverrides: z.record(z.unknown()).optional(),
	metadata: DeliveryMetadataSchema,
});

const SlackDeliveryParamsSchema = z.object({
	channel: z.literal("slack"),
	webhookUrl: z.string().url(),
	blocks: z.array(z.unknown()),
	text: z.string(),
	metadata: DeliveryMetadataSchema,
});

const TelegramDeliveryParamsSchema = z.object({
	channel: z.literal("telegram"),
	botToken: z.string().min(1),
	chatId: z.string().min(1),
	html: z.string(),
	metadata: DeliveryMetadataSchema,
});

const DiscordDeliveryParamsSchema = z.object({
	channel: z.literal("discord"),
	webhookUrl: z.string().url(),
	content: z.string(),
	embeds: z.array(z.unknown()).optional(),
	metadata: DeliveryMetadataSchema,
});

const InAppDeliveryParamsSchema = z.object({
	channel: z.literal("inApp"),
	subscriberId: z.string().min(1),
	title: z.string(),
	body: z.string(),
	data: z.record(z.unknown()).optional(),
	metadata: DeliveryMetadataSchema,
});

const WebhookDeliveryParamsSchema = z.object({
	channel: z.literal("webhook"),
	url: z.string().url(),
	payload: z.record(z.unknown()),
	headers: z.record(z.string()).optional(),
	metadata: DeliveryMetadataSchema,
});

const WhatsAppDeliveryParamsSchema = z.object({
	channel: z.literal("whatsapp"),
	to: z.string().min(1),
	templateName: z.string().min(1),
	templateParams: z.record(z.string()),
	metadata: DeliveryMetadataSchema,
});

const WebPushDeliveryParamsSchema = z.object({
	channel: z.literal("webPush"),
	subscription: z.object({
		endpoint: z.string().url(),
		keys: z.object({ p256dh: z.string(), auth: z.string() }),
	}),
	title: z.string(),
	body: z.string(),
	data: z.record(z.unknown()).optional(),
	metadata: DeliveryMetadataSchema,
});

export const ChannelDeliveryParamsSchema = z.discriminatedUnion("channel", [
	EmailDeliveryParamsSchema,
	SmsDeliveryParamsSchema,
	PushDeliveryParamsSchema,
	InAppDeliveryParamsSchema,
	WebhookDeliveryParamsSchema,
	SlackDeliveryParamsSchema,
	TelegramDeliveryParamsSchema,
	DiscordDeliveryParamsSchema,
	WhatsAppDeliveryParamsSchema,
	WebPushDeliveryParamsSchema,
]);

export const ErrorClassificationSchema = z.enum([
	"permanent",
	"transient",
	"rate_limited",
	"soft_bounce",
]);

export const DeliveryResultSchema = z.object({
	success: z.boolean(),
	providerMessageId: z.string().optional(),
	error: z.string().optional(),
	errorClassification: ErrorClassificationSchema.optional(),
});
