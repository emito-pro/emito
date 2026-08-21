import { z } from "zod";
import type {
	DiscordContent,
	EmailContent,
	InAppAction,
	InAppContent,
	PushContent,
	SlackContent,
	SmsContent,
	TelegramContent,
} from "../templates";

export const EmailContentSchema = z.object({
	subject: z.string().min(1),
	html: z.string().min(1),
	text: z.string(),
}) satisfies z.ZodType<EmailContent>;

export const SmsContentSchema = z.object({
	body: z.string().min(1),
}) satisfies z.ZodType<SmsContent>;

export const PushContentSchema = z.object({
	title: z.string().min(1),
	body: z.string().min(1),
	data: z.record(z.string()).optional(),
}) satisfies z.ZodType<PushContent>;

export const InAppActionSchema = z.object({
	label: z.string().min(1),
	url: z.string().min(1),
}) satisfies z.ZodType<InAppAction>;

export const InAppContentSchema = z.object({
	subject: z.string().optional(),
	body: z.string().min(1),
	actionUrl: z.string().optional(),
	primaryAction: InAppActionSchema.optional(),
	secondaryAction: InAppActionSchema.optional(),
	avatar: z.string().optional(),
	data: z.record(z.unknown()).optional(),
}) satisfies z.ZodType<InAppContent>;

export const SlackContentSchema = z.object({
	blocks: z.array(z.unknown()),
	text: z.string(),
}) satisfies z.ZodType<SlackContent>;

export const TelegramContentSchema = z.object({
	html: z.string().min(1),
}) satisfies z.ZodType<TelegramContent>;

export const DiscordContentSchema = z.object({
	content: z.string().min(1),
	embeds: z.array(z.unknown()).optional(),
}) satisfies z.ZodType<DiscordContent>;
