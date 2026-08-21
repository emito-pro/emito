import { ChannelSchema } from "@emito/types";
import { z } from "zod";

// --- Shared schemas ---

export const cursorQuerySchema = z.object({
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(1000).default(50).optional(),
});

export const idParamSchema = z.object({
	id: z.string().min(1),
});

// --- Admin Subscribers ---

export const createSubscriberBodySchema = z.object({
	id: z.string().min(1),
	email: z.string().email().optional(),
	phone: z.string().optional(),
	lang: z.string().optional(),
	locale: z
		.string()
		.regex(/^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/)
		.optional(),
	timezone: z
		.string()
		.regex(/^[A-Za-z_/]+$/)
		.optional(),
	metadata: z.record(z.unknown()).optional(),
});

// --- Admin Notifications ---

export const notificationFilterSchema = cursorQuerySchema.extend({
	status: z.string().optional(),
	category: z.string().optional(),
	channel: z.string().optional(),
	since: z.string().optional(),
	until: z.string().optional(),
});

// --- Admin Dead Letters ---

export const deadLetterFilterSchema = cursorQuerySchema.extend({
	resolved: z
		.enum(["true", "false"])
		.transform((v) => v === "true")
		.optional(),
});

// --- Admin Suppression ---

export const suppressionFilterSchema = cursorQuerySchema.extend({
	channel: z.string().optional(),
	includeArchived: z
		.enum(["true", "false"])
		.transform((v) => v === "true")
		.optional(),
});

export const createSuppressionBodySchema = z.object({
	address: z.string().min(1),
	channel: ChannelSchema,
	reason: z.string().min(1),
	provider: z.string().optional(),
	providerMsgId: z.string().optional(),
});

// --- Admin Consents ---

export const consentFilterSchema = cursorQuerySchema.extend({
	subscriberId: z.string().optional(),
	category: z.string().optional(),
});

export const subscriberIdParamSchema = z.object({
	subscriberId: z.string().min(1),
});

// --- Admin Workspaces ---

export const workspaceIdParamSchema = z.object({
	id: z.string().min(1),
});

export const setWorkspaceDefaultsBodySchema = z.object({
	topicKey: z.string().min(1),
	channel: ChannelSchema,
	enabled: z.boolean(),
	isMandatory: z.boolean().optional(),
});

export const createWorkspaceIntegrationBodySchema = z.object({
	channel: ChannelSchema,
	config: z.record(z.unknown()),
	name: z.string().optional(),
	events: z.array(z.string()).optional(),
	secretFields: z.array(z.string()).optional(),
});

// --- Admin Lists ---

export const createListBodySchema = z.object({
	name: z.string().min(1),
	slug: z
		.string()
		.min(1)
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
	description: z.string().optional(),
	optinType: z.enum(["single", "double"]).optional(),
	visibility: z.enum(["public", "private"]).optional(),
	categoryId: z.string().optional(),
});

export const updateListBodySchema = z.object({
	name: z.string().min(1).optional(),
	description: z.string().optional(),
});

export const listFilterSchema = cursorQuerySchema.extend({
	archived: z
		.enum(["true", "false"])
		.transform((v) => v === "true")
		.optional(),
});

export const listMemberFilterSchema = cursorQuerySchema.extend({
	status: z.string().optional(),
});

export const slugParamSchema = z.object({
	slug: z.string().min(1),
});

// --- Admin Broadcast ---

export const broadcastBodySchema = z.object({
	listSlug: z.string().min(1),
	event: z.string().min(1),
	payload: z.record(z.unknown()),
	scheduledAt: z.string().datetime().optional(),
});
