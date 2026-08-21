import type { BrandTheme } from "./config";

export interface EmailContent {
	subject: string;
	html: string;
	text: string;
}

export interface SmsContent {
	body: string;
}

export interface PushContent {
	title: string;
	body: string;
	data?: Record<string, string>;
}

export interface InAppAction {
	label: string;
	url: string;
}

export interface InAppContent {
	subject?: string;
	body: string;
	actionUrl?: string;
	primaryAction?: InAppAction;
	secondaryAction?: InAppAction;
	avatar?: string;
	data?: Record<string, unknown>;
}

export interface SlackContent {
	blocks: unknown[];
	text: string;
}

export interface TelegramContent {
	html: string;
}

export interface DiscordContent {
	content: string;
	embeds?: unknown[];
}

/**
 * Rendering metadata passed to template functions as a third argument.
 * Carries formatting context that isn't business data (payload) or visual identity (brand).
 */
export interface RenderContext {
	/** Full BCP 47 locale string for Intl formatters (e.g. 'en-GB', 'pl-PL') */
	locale: string;
	/** IANA timezone string for date rendering (e.g. 'Europe/Warsaw', 'UTC') */
	timezone: string;
}

/**
 * Multi-channel template for a single event type.
 * Each channel has its own render function that produces channel-specific content.
 * Template functions are PURE — no side effects, no DB, no Redis, no network.
 *
 * @typeParam TPayload - Type-safe event payload (developer defines per event)
 */
export interface EventTemplate<TPayload = Record<string, unknown>> {
	email?: (payload: TPayload, brand: BrandTheme, ctx: RenderContext) => Promise<EmailContent>;
	sms?: (payload: TPayload, brand: BrandTheme, ctx: RenderContext) => SmsContent;
	push?: (payload: TPayload, brand: BrandTheme, ctx: RenderContext) => PushContent;
	inApp?: (payload: TPayload, brand: BrandTheme, ctx: RenderContext) => InAppContent;
	slack?: (payload: TPayload, brand: BrandTheme, ctx: RenderContext) => SlackContent;
	telegram?: (payload: TPayload, brand: BrandTheme, ctx: RenderContext) => TelegramContent;
	discord?: (payload: TPayload, brand: BrandTheme, ctx: RenderContext) => DiscordContent;
}
