/**
 * Typed payload interfaces for all 18 default events.
 *
 * Each interface defines the expected shape of the payload for a specific event.
 * Templates use EventTemplate<TPayload> to get compile-time type safety.
 */

// ---------------------------------------------------------------------------
// Auth events
// ---------------------------------------------------------------------------

export interface WelcomePayload {
	name?: string;
}

export interface PasswordResetPayload {
	resetUrl?: string;
	code?: string;
}

export interface EmailVerificationPayload {
	verificationUrl?: string;
}

export interface LoginNewDevicePayload {
	device?: string;
	location?: string;
	ip?: string;
	time?: string;
	secureUrl?: string;
}

export interface PasswordChangedPayload {
	secureUrl?: string;
}

// biome-ignore lint/complexity/noBannedTypes: empty payload — no required fields
export type TwoFaEnabledPayload = {};

// ---------------------------------------------------------------------------
// Security events
// ---------------------------------------------------------------------------

export interface SecurityAlertPayload {
	description?: string;
	secureUrl?: string;
	device?: string;
	location?: string;
	ip?: string;
	time?: string;
}

export interface ApiKeyCreatedPayload {
	name?: string;
	permissions?: string;
	createdBy?: string;
}

export interface ApiKeyExpiringPayload {
	name?: string;
	days?: number;
}

// ---------------------------------------------------------------------------
// Team events
// ---------------------------------------------------------------------------

export interface TeamInvitationPayload {
	team?: string;
	inviterName?: string;
	inviteUrl?: string;
}

export interface TeamMemberJoinedPayload {
	name?: string;
	team?: string;
}

export interface TeamRoleChangedPayload {
	team?: string;
	role?: string;
	oldRole?: string;
	newRole?: string;
}

// ---------------------------------------------------------------------------
// Billing events
// ---------------------------------------------------------------------------

export interface PaymentSucceededPayload {
	amount?: string;
	receiptUrl?: string;
}

export interface PaymentFailedPayload {
	amount?: string;
	updateUrl?: string;
	/** @deprecated Use `updateUrl` instead. */
	url?: string;
	/** @deprecated Use `updateUrl` instead. */
	billingUrl?: string;
}

export interface TrialExpiringPayload {
	days?: number;
	/** @deprecated Use `days` instead. */
	daysLeft?: number;
	upgradeUrl?: string;
	/** @deprecated Use `upgradeUrl` instead. */
	billingUrl?: string;
}

// ---------------------------------------------------------------------------
// Trading events
// ---------------------------------------------------------------------------

export interface OrderFillPayload {
	symbol?: string;
	shares?: number;
	price?: string;
	side?: "buy" | "sell";
	orderId?: string;
}

export interface PriceAlertPayload {
	symbol?: string;
	threshold?: string;
	currentPrice?: string;
	direction?: "above" | "below";
}

// ---------------------------------------------------------------------------
// System events
// ---------------------------------------------------------------------------

export interface MaintenancePayload {
	date?: string;
	duration?: string;
	affected?: string;
	/** @deprecated Use `affected` instead. */
	affectedServices?: string;
}

export interface IncidentPayload {
	title?: string;
	affected?: string;
	status?: string;
	statusUrl?: string;
}

export interface ResolvedPayload {
	title?: string;
	summary?: string;
	/** @deprecated Use `summary` instead. */
	resolutionSummary?: string;
}
