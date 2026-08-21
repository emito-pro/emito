import type { Channel } from "./channels";

export interface RetryPolicy {
	maxAttempts: number;
	initialDelay: number;
	maxDelay: number;
	backoff: "linear" | "exponential";
	jitter?: boolean;
}

export interface RateLimitConfig {
	max: number;
	windowMs: number;
}

export interface BrandTheme {
	name: string;
	logoUrl?: string;
	appUrl: string;
	primaryColor?: string;
	secondaryColor?: string;
	backgroundColor?: string;
	textColor?: string;
	fontFamily?: string;
	supportEmail?: string;
	privacyUrl?: string;
	unsubscribeUrl?: string;
	footer?: string;
}

export interface ObservabilityConfig {
	metrics?: { enabled: boolean; prefix?: string };
	tracing?: { enabled: boolean };
}

export interface ChannelConfig {
	strategy?: "priority" | "round_robin" | "weighted";
	timeout?: number;
	retry?: RetryPolicy;
	providers: unknown[];
	weights?: number[];
}

export interface EmitoConfig<TCategories extends string = string, TEvents extends string = string> {
	database: { url: string };
	redis: { url: string };
	brand?: BrandTheme;
	transport?: "websocket" | "sse" | "polling";
	/** Default language code for template selection (e.g. 'en', 'pl') */
	defaultLang?: string;
	/** Default full BCP 47 locale for Intl formatters (e.g. 'en-GB', 'pl-PL') */
	defaultLocale?: string;
	/** Default IANA timezone for date rendering (e.g. 'Europe/Warsaw') */
	defaultTimezone?: string;
	/** Lang-keyed event templates: Record<eventType, Record<lang, EventTemplate>> */
	templates?: Record<string, Record<string, import("./templates").EventTemplate>>;
	categories?: Record<
		TCategories,
		{
			policy: "always" | "opt_out" | "opt_in";
			topics?: Record<string, { channels?: Channel[]; description?: string }>;
		}
	>;
	channels?: Partial<Record<Channel, ChannelConfig>>;
	events?: Record<
		TEvents,
		{
			category: TCategories;
			channels: Channel[];
			priority?: "critical" | "high" | "low";
			description?: string;
			bypassPreferences?: boolean;
			bypassRateLimit?: boolean;
			digest?: { windowMs: number; maxCount: number; channels?: Channel[] };
		}
	>;
	rateLimits?: Partial<Record<Channel, RateLimitConfig>>;
	observability?: ObservabilityConfig;
	/** Per-provider health check timeout in milliseconds (default 5000). */
	healthCheckTimeoutMs?: number;
}
