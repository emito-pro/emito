import { z } from "zod";

export const SubscriberSchema = z.object({
	id: z.string().min(1),
	email: z.string().email().optional(),
	phone: z.string().optional(),
	pushTokens: z.array(z.string()).optional(),
	lang: z.string().optional(),
	locale: z.string().optional(),
	timezone: z.string().optional(),
	metadata: z.record(z.unknown()).optional(),
	globallyUnsubscribed: z.boolean().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
