/**
 * security.api-key-expiring — API key approaching expiration.
 *
 * Channels: email, inApp
 * Payload: { name?: string, days?: number }
 */

import type { ApiKeyExpiringPayload, BrandTheme, EventTemplate, RenderContext } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { formatPlural } from "../../formatters/intl";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface ApiKeyExpiringEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	keyName: string;
	daysText: string;
	strings: {
		heading: string;
		bodyPrefix: string;
		bodySuffix: string;
		cta: string;
	};
}

function ApiKeyExpiringEmail({ brand, ctx, keyName, daysText, strings }: ApiKeyExpiringEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={`${strings.heading} ${daysText}`}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>
				{strings.heading} {daysText}
			</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>
				{strings.bodyPrefix} <strong>'{keyName}'</strong> {strings.bodySuffix}
			</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={`${brand.appUrl}/settings/api-keys`}
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
	heading: "API key expires in",
	bodyPrefix: "Your API key",
	bodySuffix:
		"will expire soon. Any integrations using this key will stop working after it expires.",
	cta: "Renew Key",
	inAppSubject: "API key expiring",
};

const langs = {
	en: {
		email: async (payload: ApiKeyExpiringPayload, brand: BrandTheme, ctx: RenderContext) => {
			const keyName = payload.name ?? "Unnamed key";
			const days = payload.days ?? 7;
			const daysText = `${days} ${formatPlural(days, { one: "day", other: "days" }, ctx)}`;
			const html = await render(
				<ApiKeyExpiringEmail
					brand={brand}
					ctx={ctx}
					keyName={keyName}
					daysText={daysText}
					strings={enStrings}
				/>,
			);
			const text = `API key expires in ${daysText}\n\nYour API key '${keyName}' will expire in ${daysText}. Any integrations using this key will stop working after it expires.\n\nRenew Key: ${brand.appUrl}/settings/api-keys`;
			return { subject: `API key expires in ${daysText}`, html, text };
		},
		inApp: (payload: ApiKeyExpiringPayload, _brand: BrandTheme, ctx: RenderContext) => {
			const keyName = payload.name ?? "Unnamed key";
			const days = payload.days ?? 7;
			const daysText = `${days} ${formatPlural(days, { one: "day", other: "days" }, ctx)}`;
			return {
				subject: enStrings.inAppSubject,
				body: `Key '${keyName}' expires in ${daysText}.`,
				actionUrl: "/settings/api-keys",
			};
		},
	},
} satisfies Record<string, EventTemplate<ApiKeyExpiringPayload>>;

export const securityApiKeyExpiringTemplates: Record<
	string,
	EventTemplate<ApiKeyExpiringPayload>
> = langs;
