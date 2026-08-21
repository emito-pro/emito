import { z } from "zod";
import type { BrandTheme, ObservabilityConfig, RateLimitConfig, RetryPolicy } from "../config";
import { ChannelSchema } from "./channels";

export const RetryPolicySchema = z.object({
	maxAttempts: z.number().int().positive(),
	initialDelay: z.number().nonnegative(),
	maxDelay: z.number().nonnegative(),
	backoff: z.enum(["linear", "exponential"]),
	jitter: z.boolean().optional(),
}) satisfies z.ZodType<RetryPolicy>;

export const RateLimitConfigSchema = z.object({
	max: z.number().int().positive(),
	windowMs: z.number().int().positive(),
}) satisfies z.ZodType<RateLimitConfig>;

export const BrandThemeSchema = z.object({
	name: z.string().min(1),
	logoUrl: z.string().url().optional(),
	appUrl: z.string().url(),
	primaryColor: z.string().optional(),
	secondaryColor: z.string().optional(),
	backgroundColor: z.string().optional(),
	textColor: z.string().optional(),
	fontFamily: z.string().optional(),
	supportEmail: z.string().email().optional(),
	privacyUrl: z.string().url().optional(),
	unsubscribeUrl: z.string().url().optional(),
	footer: z.string().optional(),
}) satisfies z.ZodType<BrandTheme>;

export const ObservabilityConfigSchema = z.object({
	metrics: z
		.object({
			enabled: z.boolean(),
			prefix: z.string().optional(),
		})
		.optional(),
	tracing: z
		.object({
			enabled: z.boolean(),
		})
		.optional(),
}) satisfies z.ZodType<ObservabilityConfig>;

export const ChannelConfigSchema = z.object({
	strategy: z.enum(["priority", "round_robin", "weighted"]).optional(),
	timeout: z.number().positive().optional(),
	retry: RetryPolicySchema.optional(),
	providers: z.array(z.unknown()),
	weights: z.array(z.number().positive()).optional(),
});

export const EmitoConfigSchema = z.object({
	database: z.object({ url: z.string().min(1) }),
	redis: z.object({ url: z.string().min(1) }),
	brand: BrandThemeSchema.optional(),
	transport: z.enum(["websocket", "sse", "polling"]).optional(),
	defaultLang: z.string().optional(),
	defaultLocale: z.string().optional(),
	defaultTimezone: z.string().optional(),
	templates: z.record(z.record(z.unknown())).optional(),
	categories: z
		.record(
			z.object({
				policy: z.enum(["always", "opt_out", "opt_in"]),
				topics: z
					.record(
						z.object({
							channels: z.array(ChannelSchema).optional(),
							description: z.string().optional(),
						}),
					)
					.optional(),
			}),
		)
		.optional(),
	channels: z.record(ChannelSchema, ChannelConfigSchema).optional(),
	events: z
		.record(
			z.object({
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
			}),
		)
		.optional(),
	rateLimits: z.record(ChannelSchema, RateLimitConfigSchema).optional(),
	observability: ObservabilityConfigSchema.optional(),
	healthCheckTimeoutMs: z.number().int().positive().optional(),
});
