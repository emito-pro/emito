import { ChannelSchema } from "@emito/types";
import { z } from "zod";

// --- Workspace ID params ---

export const workspaceIdParamsSchema = z.object({
	wsId: z.string().startsWith("ws_"),
});

// --- Workspace + integration ID params ---

export const workspaceIntegrationIdParamsSchema = z.object({
	wsId: z.string().startsWith("ws_"),
	id: z.string().min(1),
});

// --- Workspace preference body ---

export const workspacePreferenceBodySchema = z.object({
	topicKey: z.string().min(1),
	channel: ChannelSchema,
	enabled: z.boolean(),
});

// --- Workspace defaults body ---

export const workspaceDefaultsBodySchema = z.object({
	topicKey: z.string().min(1),
	channel: ChannelSchema,
	enabled: z.boolean(),
	isMandatory: z.boolean(),
});

// --- Workspace integration create body ---

export const workspaceIntegrationCreateBodySchema = z.object({
	channel: ChannelSchema,
	name: z.string().optional(),
	events: z.array(z.string()).optional(),
	config: z.record(z.unknown()),
	secretFields: z.array(z.string()).optional(),
});

// --- Workspace integration update body ---

export const workspaceIntegrationUpdateBodySchema = z.object({
	name: z.string().optional(),
	events: z.array(z.string()).optional(),
	config: z.record(z.unknown()).optional(),
});
