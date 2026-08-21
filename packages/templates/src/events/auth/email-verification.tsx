/**
 * auth.email-verification — Verify your email.
 *
 * Channels: email
 * Payload: { verificationUrl?: string }
 */

import type {
	BrandTheme,
	EmailVerificationPayload,
	EventTemplate,
	RenderContext,
} from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface EmailVerificationEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	verificationUrl: string;
	strings: {
		heading: string;
		body: string;
		cta: string;
	};
}

function EmailVerificationEmail({
	brand,
	ctx,
	verificationUrl,
	strings,
}: EmailVerificationEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.heading}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={verificationUrl}
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
	heading: "Verify your email",
	body: "Please verify your email address by clicking the button below.",
	cta: "Verify Email",
};

const langs = {
	en: {
		email: async (payload: EmailVerificationPayload, brand: BrandTheme, ctx: RenderContext) => {
			const verificationUrl = payload.verificationUrl ?? brand.appUrl;
			const html = await render(
				<EmailVerificationEmail
					brand={brand}
					ctx={ctx}
					verificationUrl={verificationUrl}
					strings={enStrings}
				/>,
			);
			const text = `${enStrings.heading}\n\n${enStrings.body}\n\n${enStrings.cta}: ${verificationUrl}`;
			return { subject: enStrings.heading, html, text };
		},
	},
} satisfies Record<string, EventTemplate<EmailVerificationPayload>>;

export const emailVerificationTemplates: Record<
	string,
	EventTemplate<EmailVerificationPayload>
> = langs;
