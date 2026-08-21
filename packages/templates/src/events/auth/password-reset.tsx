/**
 * auth.password-reset — Reset your password.
 *
 * Channels: email, sms
 * Payload: { resetUrl?: string, code?: string }
 */

import type { BrandTheme, EventTemplate, PasswordResetPayload, RenderContext } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface PasswordResetEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	resetUrl: string;
	strings: {
		heading: string;
		body: string;
		cta: string;
		ignore: string;
	};
}

function PasswordResetEmail({ brand, ctx, resetUrl, strings }: PasswordResetEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.heading}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={resetUrl}
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
			<Text style={{ margin: "16px 0 0 0", color: THEME_DEFAULTS.mutedColor, fontSize: "14px" }}>
				{strings.ignore}
			</Text>
		</BaseEmailLayout>
	);
}

// ---------------------------------------------------------------------------
// Lang strings
// ---------------------------------------------------------------------------

const enStrings = {
	heading: "Reset your password",
	body: "We received a request to reset your password. Click the button below to choose a new one. This link expires in 15 minutes.",
	cta: "Reset Password",
	ignore: "If you didn't request this, you can safely ignore this email.",
	smsBody: (brandName: string, code: string) =>
		`${brandName}: Your reset code is ${code}. Expires in 15 minutes.`,
};

const langs = {
	en: {
		email: async (payload: PasswordResetPayload, brand: BrandTheme, ctx: RenderContext) => {
			const resetUrl = payload.resetUrl ?? brand.appUrl;
			const html = await render(
				<PasswordResetEmail brand={brand} ctx={ctx} resetUrl={resetUrl} strings={enStrings} />,
			);
			const text = `${enStrings.heading}\n\n${enStrings.body}\n\n${enStrings.cta}: ${resetUrl}\n\n${enStrings.ignore}`;
			return { subject: enStrings.heading, html, text };
		},
		sms: (payload: PasswordResetPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const code = payload.code ?? "";
			const raw = enStrings.smsBody(brand.name, code);
			return { body: raw.length > 160 ? `${raw.slice(0, 157)}...` : raw };
		},
	},
} satisfies Record<string, EventTemplate<PasswordResetPayload>>;

export const passwordResetTemplates: Record<string, EventTemplate<PasswordResetPayload>> = langs;
