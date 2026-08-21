/**
 * security.api-key-created — New API key created notification.
 *
 * Channels: email, inApp
 * Payload: { name?: string, permissions?: string, createdBy?: string }
 */

import type { ApiKeyCreatedPayload, BrandTheme, EventTemplate, RenderContext } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface ApiKeyCreatedEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	keyName: string;
	permissions?: string;
	createdBy?: string;
	strings: {
		heading: string;
		keyNameLabel: string;
		permissionsLabel: string;
		createdByLabel: string;
		cta: string;
	};
}

function ApiKeyCreatedEmail({
	brand,
	ctx,
	keyName,
	permissions,
	createdBy,
	strings,
}: ApiKeyCreatedEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.heading}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Section
				style={{
					backgroundColor: THEME_DEFAULTS.surfaceColor,
					padding: "16px",
					borderRadius: "8px",
					margin: "0 0 16px 0",
				}}
			>
				<Text style={{ margin: "0 0 4px 0" }}>
					<strong>{strings.keyNameLabel}:</strong> {keyName}
				</Text>
				{permissions && (
					<Text style={{ margin: "0 0 4px 0" }}>
						<strong>{strings.permissionsLabel}:</strong> {permissions}
					</Text>
				)}
				{createdBy && (
					<Text style={{ margin: "0" }}>
						<strong>{strings.createdByLabel}:</strong> {createdBy}
					</Text>
				)}
			</Section>
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
	heading: "New API key created",
	keyNameLabel: "Key name",
	permissionsLabel: "Permissions",
	createdByLabel: "Created by",
	cta: "Manage Keys",
	inAppSubject: "API key created",
};

const langs = {
	en: {
		email: async (payload: ApiKeyCreatedPayload, brand: BrandTheme, ctx: RenderContext) => {
			const keyName = payload.name ?? "Unnamed key";
			const html = await render(
				<ApiKeyCreatedEmail
					brand={brand}
					ctx={ctx}
					keyName={keyName}
					permissions={payload.permissions}
					createdBy={payload.createdBy}
					strings={enStrings}
				/>,
			);
			const parts = [`${enStrings.heading}\n`, `Key name: ${keyName}`];
			if (payload.permissions) parts.push(`Permissions: ${payload.permissions}`);
			if (payload.createdBy) parts.push(`Created by: ${payload.createdBy}`);
			parts.push("", `${enStrings.cta}: ${brand.appUrl}/settings/api-keys`);
			return { subject: enStrings.heading, html, text: parts.join("\n") };
		},
		inApp: (payload: ApiKeyCreatedPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const keyName = payload.name ?? "Unnamed key";
			return {
				subject: enStrings.inAppSubject,
				body: `New API key '${keyName}' was created.`,
				actionUrl: "/settings/api-keys",
			};
		},
	},
} satisfies Record<string, EventTemplate<ApiKeyCreatedPayload>>;

export const securityApiKeyCreatedTemplates: Record<
	string,
	EventTemplate<ApiKeyCreatedPayload>
> = langs;
