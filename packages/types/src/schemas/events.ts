import { z } from "zod";
import { ChannelSchema } from "./channels";

export const CategoryDefinitionSchema = z.object({
	policy: z.enum(["always", "opt_out", "opt_in"]),
	topics: z
		.record(
			z.object({
				channels: z.array(ChannelSchema).optional(),
				description: z.string().optional(),
			}),
		)
		.optional(),
});

export const EventDefinitionSchema = z.object({
	category: z.string(),
	channels: z.array(ChannelSchema),
	priority: z.enum(["critical", "high", "low"]).optional(),
	description: z.string().optional(),
	bypassPreferences: z.boolean().optional(),
	bypassRateLimit: z.boolean().optional(),
	digest: z
		.object({
			windowMs: z.number().positive(),
			maxCount: z.number().int().positive(),
			channels: z.array(ChannelSchema).optional(),
		})
		.optional(),
});
