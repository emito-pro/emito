/**
 * auth.password-changed — Password change confirmation.
 *
 * Channels: email, sms, push
 * Payload: { secureUrl?: string }
 */

import type {
	BrandTheme,
	EventTemplate,
	PasswordChangedPayload,
	RenderContext,
} from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface PasswordChangedEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	secureUrl: string;
	strings: {
		heading: string;
		body: string;
		cta: string;
	};
}

function PasswordChangedEmail({ brand, ctx, secureUrl, strings }: PasswordChangedEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.heading}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={secureUrl}
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
	heading: "Your password was changed",
	body: "Your password has been successfully updated. If you did not make this change, please secure your account immediately.",
	cta: "Not you? Secure your account",
	pushTitle: "Password Changed",
	pushBody: "Your password was updated successfully.",
};

const langs = {
	en: {
		email: async (payload: PasswordChangedPayload, brand: BrandTheme, ctx: RenderContext) => {
			const secureUrl = payload.secureUrl ?? `${brand.appUrl}/security`;
			const html = await render(
				<PasswordChangedEmail brand={brand} ctx={ctx} secureUrl={secureUrl} strings={enStrings} />,
			);
			const text = `${enStrings.heading}\n\n${enStrings.body}\n\nSecure your account: ${secureUrl}`;
			return { subject: enStrings.heading, html, text };
		},
		sms: (payload: PasswordChangedPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const secureUrl = payload.secureUrl ?? "";
			const raw = `${brand.name}: Your password was changed. Not you? ${secureUrl}`;
			return { body: raw.length > 160 ? `${raw.slice(0, 157)}...` : raw };
		},
		push: (_payload: PasswordChangedPayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			title: enStrings.pushTitle,
			body: enStrings.pushBody,
		}),
	},
} satisfies Record<string, EventTemplate<PasswordChangedPayload>>;

export const passwordChangedTemplates: Record<
	string,
	EventTemplate<PasswordChangedPayload>
> = langs;
