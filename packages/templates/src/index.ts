export { resolveLang, resolveTemplateLang } from "./lang";
export type { ResolveLangParams } from "./lang";

export { createFallbackTemplate } from "./fallback";

export { buildTemplate } from "./builder";
export type {
	LangStringsMap,
	ChannelStringsMap,
	EmailStrings,
	SmsStrings,
	PushStrings,
	InAppStrings,
	SlackStrings,
	TelegramStrings,
} from "./builder";

export { BaseEmailLayout } from "./layout/base-email-layout";
export type { BaseEmailLayoutProps, BaseEmailLayoutStrings } from "./layout/base-email-layout";

export {
	formatDate,
	formatTime,
	formatDateTime,
	formatCurrency,
	formatNumber,
	formatPlural,
} from "./formatters/intl";
export type { PluralForms } from "./formatters/intl";

export { isRtl } from "./formatters/rtl";

export { formatSlackBlocks } from "./formatters/slack";
export type { SlackBlockParams } from "./formatters/slack";

export { formatTelegramHtml } from "./formatters/telegram";
export type { TelegramMessageParams } from "./formatters/telegram";

export { THEME_DEFAULTS } from "./theme-defaults";

// ---------------------------------------------------------------------------
// Event templates
// ---------------------------------------------------------------------------

import { twoFaEnabledTemplates } from "./events/auth/2fa-enabled";
import { emailVerificationTemplates } from "./events/auth/email-verification";
import { loginNewDeviceTemplates } from "./events/auth/login-new-device";
import { passwordChangedTemplates } from "./events/auth/password-changed";
import { passwordResetTemplates } from "./events/auth/password-reset";
// Auth events
import { welcomeTemplates } from "./events/auth/welcome";

// Security events
import { securityAlertTemplates } from "./events/security/alert";
import { securityApiKeyCreatedTemplates } from "./events/security/api-key-created";
import { securityApiKeyExpiringTemplates } from "./events/security/api-key-expiring";

// Team events
import { teamInvitationTemplates } from "./events/team/invitation";
import { teamMemberJoinedTemplates } from "./events/team/member-joined";
import { teamRoleChangedTemplates } from "./events/team/role-changed";

import { billingPaymentFailedTemplates } from "./events/billing/payment-failed";
// Billing events
import { billingPaymentSucceededTemplates } from "./events/billing/payment-succeeded";
import { billingTrialExpiringTemplates } from "./events/billing/trial-expiring";

import { systemIncidentTemplates } from "./events/system/incident";
// System events
import { systemMaintenanceTemplates } from "./events/system/maintenance";
import { systemResolvedTemplates } from "./events/system/resolved";

// Trading events
import { orderFillTemplates } from "./events/trading/order-fill";
import { priceAlertTemplates } from "./events/trading/price-alert";

export { welcomeTemplates } from "./events/auth/welcome";
export { passwordResetTemplates } from "./events/auth/password-reset";
export { emailVerificationTemplates } from "./events/auth/email-verification";
export { loginNewDeviceTemplates } from "./events/auth/login-new-device";
export { passwordChangedTemplates } from "./events/auth/password-changed";
export { twoFaEnabledTemplates } from "./events/auth/2fa-enabled";
export { securityAlertTemplates } from "./events/security/alert";
export { securityApiKeyCreatedTemplates } from "./events/security/api-key-created";
export { securityApiKeyExpiringTemplates } from "./events/security/api-key-expiring";

export { teamInvitationTemplates } from "./events/team/invitation";
export { teamMemberJoinedTemplates } from "./events/team/member-joined";
export { teamRoleChangedTemplates } from "./events/team/role-changed";
export { billingPaymentSucceededTemplates } from "./events/billing/payment-succeeded";
export { billingPaymentFailedTemplates } from "./events/billing/payment-failed";
export { billingTrialExpiringTemplates } from "./events/billing/trial-expiring";
export { systemMaintenanceTemplates } from "./events/system/maintenance";
export { systemIncidentTemplates } from "./events/system/incident";
export { systemResolvedTemplates } from "./events/system/resolved";

export { orderFillTemplates } from "./events/trading/order-fill";
export { priceAlertTemplates } from "./events/trading/price-alert";

// ---------------------------------------------------------------------------
// defaultTemplates — combined registry of all event templates
// ---------------------------------------------------------------------------

import type { EventTemplate } from "@emito/types";

export const defaultTemplates: Record<string, Record<string, EventTemplate>> = {
	// Auth events
	"auth.welcome": welcomeTemplates,
	"auth.password-reset": passwordResetTemplates,
	"auth.email-verification": emailVerificationTemplates,
	"auth.login-new-device": loginNewDeviceTemplates,
	"auth.password-changed": passwordChangedTemplates,
	"auth.2fa-enabled": twoFaEnabledTemplates,

	// Security events
	"security.alert": securityAlertTemplates,
	"security.api-key-created": securityApiKeyCreatedTemplates,
	"security.api-key-expiring": securityApiKeyExpiringTemplates,

	// Team events
	"team.invitation": teamInvitationTemplates,
	"team.member-joined": teamMemberJoinedTemplates,
	"team.role-changed": teamRoleChangedTemplates,

	// Billing events
	"billing.payment-succeeded": billingPaymentSucceededTemplates,
	"billing.payment-failed": billingPaymentFailedTemplates,
	"billing.trial-expiring": billingTrialExpiringTemplates,

	// System events
	"system.maintenance": systemMaintenanceTemplates,
	"system.incident": systemIncidentTemplates,
	"system.resolved": systemResolvedTemplates,

	// Trading events
	"order.fill": orderFillTemplates,
	"price.alert": priceAlertTemplates,
};
