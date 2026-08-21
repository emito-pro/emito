import { ChannelSchema } from "@emito/types";
import { z } from "zod";

// --- Notification params ---

export const notificationIdParamsSchema = z.object({
	id: z.string().min(1),
});

// --- Notification list query ---

export const notificationListQuerySchema = z.object({
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(1000).default(50).optional(),
	status: z.enum(["unread", "read", "archived"]).optional(),
	category: z.string().optional(),
});

// --- Snooze body ---

export const snoozeBodySchema = z.object({
	until: z.coerce.date(),
});

// --- Preference body ---

export const preferenceBodySchema = z.object({
	topicKey: z.string().min(1),
	channel: ChannelSchema,
	enabled: z.boolean(),
});

// --- Integration create body ---

export const integrationCreateBodySchema = z.object({
	channel: ChannelSchema,
	name: z.string().optional(),
	events: z.array(z.string()).optional(),
	config: z.record(z.unknown()),
});

// --- Integration update body ---

export const integrationUpdateBodySchema = z.object({
	name: z.string().optional(),
	events: z.array(z.string()).optional(),
	config: z.record(z.unknown()).optional(),
});

// --- Integration ID params ---

export const integrationIdParamsSchema = z.object({
	id: z.string().min(1),
});
