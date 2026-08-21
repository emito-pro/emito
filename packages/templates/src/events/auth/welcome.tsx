/**
 * auth.welcome — Welcome email + in-app notification.
 *
 * Channels: email, inApp
 * Payload: { name?: string }
 */

import type { BrandTheme, EventTemplate, RenderContext, WelcomePayload } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface WelcomeEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	name?: string;
	strings: {
		greeting: string;
		body: string;
		cta: string;
	};
}

function WelcomeEmail({ brand, ctx, strings }: WelcomeEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.greeting}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.greeting}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={`${brand.appUrl}/start`}
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
	greeting: (name?: string) => (name ? `Welcome, ${name}!` : "Welcome!"),
	body: "Your account is ready. We're excited to have you on board.",
	cta: "Get Started",
	subject: (brandName: string) => `Welcome to ${brandName}!`,
	inAppSubject: "Welcome!",
	inAppBody: "Your account is ready. Let's get started.",
};

const langs = {
	en: {
		email: async (payload: WelcomePayload, brand: BrandTheme, ctx: RenderContext) => {
			const strings = {
				greeting: enStrings.greeting(payload.name),
				body: enStrings.body,
				cta: enStrings.cta,
			};
			const html = await render(
				<WelcomeEmail brand={brand} ctx={ctx} name={payload.name} strings={strings} />,
			);
			const text = `${strings.greeting}\n\n${strings.body}\n\n${enStrings.cta}: ${brand.appUrl}/start`;
			return { subject: enStrings.subject(brand.name), html, text };
		},
		inApp: (_payload: WelcomePayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			subject: enStrings.inAppSubject,
			body: enStrings.inAppBody,
			actionUrl: "/start",
		}),
	},
} satisfies Record<string, EventTemplate<WelcomePayload>>;

export const welcomeTemplates: Record<string, EventTemplate<WelcomePayload>> = langs;
