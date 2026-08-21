export type DeliveryStatus =
	| "pending"
	| "sent"
	| "delivered"
	| "deferred"
	| "bounced"
	| "failed"
	| "suppressed"
	| "complained"
	| "opened"
	| "machine_opened"
	| "clicked"
	| "unsubscribed"
	| "read"
	| "digested"
	| "blocked_by_preference"
	| "blocked_by_consent"
	| "blocked_by_admin";

export type DeliveryStatusCategory = "delivery" | "engagement";

const ENGAGEMENT_STATUSES: ReadonlySet<DeliveryStatus> = new Set([
	"complained",
	"opened",
	"machine_opened",
	"clicked",
	"unsubscribed",
	"read",
]);

export function classifyStatus(status: DeliveryStatus): DeliveryStatusCategory {
	return ENGAGEMENT_STATUSES.has(status) ? "engagement" : "delivery";
}

export function isTerminal(status: DeliveryStatus): boolean {
	return TERMINAL_STATUSES.has(status);
}

const TERMINAL_STATUSES: ReadonlySet<DeliveryStatus> = new Set([
	"delivered",
	"bounced",
	"failed",
	"suppressed",
	"blocked_by_preference",
	"blocked_by_consent",
	"blocked_by_admin",
]);
