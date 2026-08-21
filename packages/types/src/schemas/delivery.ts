import { z } from "zod";
import { ChannelSchema } from "./channels";
import { ErrorClassificationSchema } from "./providers";

export const SendParamsSchema = z.object({
	event: z.string().min(1),
	subscriberId: z.string().min(1),
	workspaceId: z.string().optional(),
	recipient: z
		.object({
			email: z.string().email().optional(),
			phone: z.string().optional(),
			pushTokens: z.array(z.string()).optional(),
		})
		.optional(),
	payload: z.record(z.unknown()),
	lang: z.string().optional(),
	locale: z.string().optional(),
	timezone: z.string().optional(),
	scheduledAt: z.date().optional(),
	delay: z.string().optional(),
	idempotencyKey: z.string().optional(),
	providerOverrides: z.record(z.record(z.unknown())).optional(),
});

export const ChannelResultSchema = z.object({
	channel: ChannelSchema,
	status: z.enum([
		"sent",
		"rate_limited",
		"digested",
		"failed",
		"suppressed",
		"no_provider",
		"blocked_by_preference",
		"blocked_by_consent",
		"blocked_by_admin",
	]),
	provider: z.string().optional(),
	providerMessageId: z.string().optional(),
	error: z.string().optional(),
	errorClassification: ErrorClassificationSchema.optional(),
});

export const SendResultSchema = z.object({
	notificationId: z.string().min(1),
	channels: z.array(ChannelResultSchema),
});
