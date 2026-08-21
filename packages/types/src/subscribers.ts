export interface Subscriber {
	id: string;
	email?: string;
	phone?: string;
	pushTokens?: string[];
	/** Language code for template selection (e.g. 'en', 'pl') */
	lang?: string;
	/** Full BCP 47 locale for Intl formatters (e.g. 'en-GB', 'pl-PL') */
	locale?: string;
	/** IANA timezone for date rendering (e.g. 'Europe/Warsaw') */
	timezone?: string;
	metadata?: Record<string, unknown>;
	globallyUnsubscribed?: boolean;
	erasedAt?: Date | null;
	createdAt: Date;
	updatedAt: Date;
}
