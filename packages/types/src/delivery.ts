import type { Channel } from "./channels";
import type { ErrorClassification } from "./errors";

export interface SendParams<TEvent extends string = string> {
	event: TEvent;
	subscriberId: string;
	workspaceId?: string;
	recipient?: { email?: string; phone?: string; pushTokens?: string[] };
	payload: Record<string, unknown>;
	/** Language code for template selection (e.g. 'en', 'pl') */
	lang?: string;
	/** Full BCP 47 locale for Intl formatters (e.g. 'en-GB', 'pl-PL') */
	locale?: string;
	/** IANA timezone for date rendering (e.g. 'Europe/Warsaw') */
	timezone?: string;
	scheduledAt?: Date;
	delay?: string;
	idempotencyKey?: string;
	providerOverrides?: Record<string, Record<string, unknown>>;
}

export interface ChannelResult {
	channel: Channel;
	status:
		| "sent"
		| "rate_limited"
		| "digested"
		| "failed"
		| "suppressed"
		| "no_provider"
		| "blocked_by_preference"
		| "blocked_by_consent"
		| "blocked_by_admin";
	provider?: string;
	providerMessageId?: string;
	error?: string;
	errorClassification?: ErrorClassification;
}

export interface SendResult {
	notificationId: string;
	channels: ChannelResult[];
}
