/**
 * billing.trial-expiring — Trial expiration warning across email, push, in-app.
 *
 * Channels: email, push, inApp
 * Payload: { daysLeft?: number, days?: number, upgradeUrl?: string, billingUrl?: string }
 */

import type { BrandTheme, EventTemplate, RenderContext, TrialExpiringPayload } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { formatPlural } from "../../formatters/intl";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface TrialExpiringEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	daysText: string;
	upgradeUrl: string;
	strings: {
		heading: string;
		body: string;
		cta: string;
	};
}

function TrialExpiringEmail({
	brand,
	ctx,
	daysText,
	upgradeUrl,
	strings,
}: TrialExpiringEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={enStrings.emailPreview(daysText)}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={upgradeUrl || brand.appUrl}
					style={{
						backgroundColor: brand.primaryColor ?? THEME_DEFAULTS.primaryColor,
						color: THEME_DEFAULTS.buttonTextColor,
						padding: THEME_DEFAULTS.buttonPadding,
						borderRadius: THEME_DEFAULTS.buttonRadius,
						fontWeight: "bold",
					}}
				>
					{strings.cta}
				</Button>
			</Section>
		</BaseEmailLayout>
	);
}

// ---------------------------------------------------------------------------
// Lang strings
// ---------------------------------------------------------------------------

const enStrings = {
	heading: "Trial Ending Soon",
	cta: "Upgrade Now",
	emailBody: (daysText: string) =>
		`Your trial expires in ${daysText}. Upgrade now to keep access to all features.`,
	emailSubject: (daysText: string) => `Your trial ends in ${daysText}`,
	emailPreview: (daysText: string) => `Your trial ends in ${daysText}`,
	pushTitle: "Trial Ending",
	pushBody: (daysText: string) => `${daysText} left on your trial.`,
	inAppSubject: "Trial ending soon",
	inAppBody: (daysText: string) => `Your trial expires in ${daysText}.`,
};

const langs = {
	en: {
		email: async (payload: TrialExpiringPayload, brand: BrandTheme, ctx: RenderContext) => {
			const days = payload.daysLeft ?? payload.days ?? 0;
			const daysText = `${days} ${formatPlural(days, { one: "day", other: "days" }, ctx)}`;
			const upgradeUrl = String(payload.upgradeUrl ?? payload.billingUrl ?? brand.appUrl);
			const strings = {
				heading: enStrings.heading,
				body: enStrings.emailBody(daysText),
				cta: enStrings.cta,
			};
			const html = await render(
				<TrialExpiringEmail
					brand={brand}
					ctx={ctx}
					daysText={daysText}
					upgradeUrl={upgradeUrl}
					strings={strings}
				/>,
			);
			const text = `${strings.heading}\n\n${strings.body}\n\n${strings.cta}: ${upgradeUrl}`;
			return { subject: enStrings.emailSubject(daysText), html, text };
		},
		push: (payload: TrialExpiringPayload, _brand: BrandTheme, ctx: RenderContext) => {
			const days = payload.daysLeft ?? payload.days ?? 0;
			const daysText = `${days} ${formatPlural(days, { one: "day", other: "days" }, ctx)}`;
			return {
				title: enStrings.pushTitle,
				body: enStrings.pushBody(daysText),
			};
		},
		inApp: (payload: TrialExpiringPayload, _brand: BrandTheme, ctx: RenderContext) => {
			const days = payload.daysLeft ?? payload.days ?? 0;
			const daysText = `${days} ${formatPlural(days, { one: "day", other: "days" }, ctx)}`;
			return {
				subject: enStrings.inAppSubject,
				body: enStrings.inAppBody(daysText),
				actionUrl: "/billing",
			};
		},
	},
} satisfies Record<string, EventTemplate<TrialExpiringPayload>>;

export const billingTrialExpiringTemplates: Record<
	string,
	EventTemplate<TrialExpiringPayload>
> = langs;
