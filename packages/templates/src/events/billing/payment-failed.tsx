/**
 * billing.payment-failed — Payment failure notification across email, SMS, push, in-app.
 *
 * Channels: email, sms, push, inApp
 * Payload: { amount?: string, url?: string, updateUrl?: string, billingUrl?: string }
 */

import type { BrandTheme, EventTemplate, PaymentFailedPayload, RenderContext } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface PaymentFailedEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	amount: string;
	updateUrl: string;
	strings: {
		heading: string;
		bodyPrefix: string;
		bodySuffix: string;
		cta: string;
	};
}

function PaymentFailedEmail({ brand, ctx, amount, updateUrl, strings }: PaymentFailedEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={`${strings.heading} — action required`}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>
				{strings.bodyPrefix} {amount} {strings.bodySuffix}
			</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={updateUrl || brand.appUrl}
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
	heading: "Payment Failed",
	bodyPrefix: "Your payment of",
	bodySuffix:
		"could not be processed. Please update your payment method to avoid service interruption.",
	cta: "Update Payment Method",
	inAppSubject: "Payment failed",
	inAppBody: "Update your payment method.",
	pushTitle: "Payment Failed",
};

const langs = {
	en: {
		email: async (payload: PaymentFailedPayload, brand: BrandTheme, ctx: RenderContext) => {
			const amount = String(payload.amount ?? "");
			const updateUrl = String(payload.updateUrl ?? payload.billingUrl ?? brand.appUrl);
			const html = await render(
				<PaymentFailedEmail
					brand={brand}
					ctx={ctx}
					amount={amount}
					updateUrl={updateUrl}
					strings={enStrings}
				/>,
			);
			const text = `${enStrings.heading}\n\n${enStrings.bodyPrefix} ${amount} ${enStrings.bodySuffix}\n\n${enStrings.cta}: ${updateUrl}`;
			return { subject: "Payment failed — action required", html, text };
		},
		sms: (payload: PaymentFailedPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const amount = String(payload.amount ?? "");
			const url = String(payload.updateUrl ?? payload.url ?? "");
			const body = `${brand.name}: Payment of ${amount} failed. Update: ${url}`;
			return { body: body.length > 160 ? `${body.slice(0, 157)}...` : body };
		},
		push: (payload: PaymentFailedPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const amount = String(payload.amount ?? "");
			return {
				title: enStrings.pushTitle,
				body: `Your payment of ${amount} could not be processed.`,
			};
		},
		inApp: (_payload: PaymentFailedPayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			subject: enStrings.inAppSubject,
			body: enStrings.inAppBody,
			actionUrl: "/billing",
		}),
	},
} satisfies Record<string, EventTemplate<PaymentFailedPayload>>;

export const billingPaymentFailedTemplates: Record<
	string,
	EventTemplate<PaymentFailedPayload>
> = langs;
