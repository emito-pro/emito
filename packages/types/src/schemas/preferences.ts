import { z } from "zod";
import type { PreferenceRecord, WorkspaceDefault } from "../preferences";
import { ChannelSchema } from "./channels";

export const PreferenceRecordSchema = z.object({
	subscriberId: z.string().min(1),
	workspaceId: z.string().optional(),
	topicKey: z.string().min(1),
	channel: ChannelSchema,
	enabled: z.boolean(),
}) satisfies z.ZodType<PreferenceRecord>;

export const WorkspaceDefaultSchema = z.object({
	workspaceId: z.string().min(1),
	topicKey: z.string().min(1),
	channel: ChannelSchema,
	enabled: z.boolean(),
	isMandatory: z.boolean(),
}) satisfies z.ZodType<WorkspaceDefault>;
