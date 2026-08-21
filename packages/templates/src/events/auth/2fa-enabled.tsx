/**
 * auth.2fa-enabled — Two-factor authentication enabled confirmation.
 *
 * Channels: email, inApp
 * Payload: {}
 */

import type { BrandTheme, EventTemplate, RenderContext, TwoFaEnabledPayload } from "@emito/types";
import { Heading, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface TwoFaEnabledEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	strings: {
		heading: string;
		body: string;
	};
}

function TwoFaEnabledEmail({ brand, ctx, strings }: TwoFaEnabledEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.heading}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
		</BaseEmailLayout>
	);
}

// ---------------------------------------------------------------------------
// Lang strings
// ---------------------------------------------------------------------------

const enStrings = {
	heading: "Two-factor authentication enabled",
	body: "Two-factor authentication has been successfully enabled on your account. Your account is now more secure.",
	inAppSubject: "2FA Enabled",
	inAppBody: "Two-factor authentication is now active on your account.",
};

const langs = {
	en: {
		email: async (_payload: TwoFaEnabledPayload, brand: BrandTheme, ctx: RenderContext) => {
			const html = await render(<TwoFaEnabledEmail brand={brand} ctx={ctx} strings={enStrings} />);
			const text = `${enStrings.heading}\n\n${enStrings.body}`;
			return { subject: enStrings.heading, html, text };
		},
		inApp: (_payload: TwoFaEnabledPayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			subject: enStrings.inAppSubject,
			body: enStrings.inAppBody,
		}),
	},
} satisfies Record<string, EventTemplate<TwoFaEnabledPayload>>;

export const twoFaEnabledTemplates: Record<string, EventTemplate<TwoFaEnabledPayload>> = langs;
