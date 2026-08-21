/**
 * billing.payment-succeeded — Payment receipt email + in-app notification.
 *
 * Channels: email, inApp
 * Payload: { amount?: string, receiptUrl?: string }
 */

import type {
	BrandTheme,
	EventTemplate,
	PaymentSucceededPayload,
	RenderContext,
} from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface PaymentSucceededEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	amount: string;
	receiptUrl: string;
	strings: {
		heading: string;
		bodyPrefix: string;
		bodySuffix: string;
		cta: string;
	};
}

function PaymentSucceededEmail({
	brand,
	ctx,
	amount,
	receiptUrl,
	strings,
}: PaymentSucceededEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={`${strings.heading} — ${amount}`}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>
				{strings.bodyPrefix} {amount} {strings.bodySuffix}
			</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={receiptUrl || brand.appUrl}
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
	heading: "Payment Received",
	bodyPrefix: "Your payment of",
	bodySuffix: "has been processed successfully. Thank you!",
	cta: "View Receipt",
	inAppSubject: "Payment received",
};

const langs = {
	en: {
		email: async (payload: PaymentSucceededPayload, brand: BrandTheme, ctx: RenderContext) => {
			const amount = String(payload.amount ?? "");
			const receiptUrl = String(payload.receiptUrl ?? brand.appUrl);
			const html = await render(
				<PaymentSucceededEmail
					brand={brand}
					ctx={ctx}
					amount={amount}
					receiptUrl={receiptUrl}
					strings={enStrings}
				/>,
			);
			const text = `${enStrings.heading}\n\n${enStrings.bodyPrefix} ${amount} ${enStrings.bodySuffix}\n\n${enStrings.cta}: ${receiptUrl}`;
			return { subject: `Payment received — ${amount}`, html, text };
		},
		inApp: (payload: PaymentSucceededPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const amount = String(payload.amount ?? "");
			return {
				subject: enStrings.inAppSubject,
				body: `Payment of ${amount} processed successfully.`,
			};
		},
	},
} satisfies Record<string, EventTemplate<PaymentSucceededPayload>>;

export const billingPaymentSucceededTemplates: Record<
	string,
	EventTemplate<PaymentSucceededPayload>
> = langs;
