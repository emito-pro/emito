/**
 * system.incident — Service incident notification across email, push, in-app.
 *
 * Channels: email, push, inApp
 * Payload: { title?: string, affected?: string, status?: string, statusUrl?: string }
 */

import type { BrandTheme, EventTemplate, IncidentPayload, RenderContext } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface IncidentEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	statusUrl: string;
	strings: {
		heading: string;
		body: string;
		cta: string;
	};
}

function IncidentEmail({ brand, ctx, statusUrl, strings }: IncidentEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.heading}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
			{statusUrl && (
				<Section style={{ textAlign: "center" as const }}>
					<Button
						href={statusUrl}
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
			)}
		</BaseEmailLayout>
	);
}

// ---------------------------------------------------------------------------
// Lang strings
// ---------------------------------------------------------------------------

const enStrings = {
	heading: "Service Incident",
	cta: "Status Page",
	pushTitle: "Service Incident",
	inAppSubject: "Incident",
};

const langs = {
	en: {
		email: async (payload: IncidentPayload, brand: BrandTheme, ctx: RenderContext) => {
			const title = String(payload.title ?? "");
			const affected = String(payload.affected ?? "");
			const status = String(payload.status ?? "investigating");
			const statusUrl = String(payload.statusUrl ?? "");
			const strings = {
				heading: enStrings.heading,
				body: `We're investigating an issue affecting ${affected}. Current status: ${status}. We'll provide updates as we learn more.`,
				cta: enStrings.cta,
			};
			const html = await render(
				<IncidentEmail brand={brand} ctx={ctx} statusUrl={statusUrl} strings={strings} />,
			);
			const text = `${strings.heading}\n\n${strings.body}${statusUrl ? `\n\nStatus Page: ${statusUrl}` : ""}`;
			return { subject: `Service incident: ${title}`, html, text };
		},
		push: (payload: IncidentPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const title = String(payload.title ?? enStrings.pushTitle);
			return {
				title: enStrings.pushTitle,
				body: title || enStrings.pushTitle,
			};
		},
		inApp: (payload: IncidentPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const title = String(payload.title ?? "");
			const affected = String(payload.affected ?? "");
			const statusUrl = String(payload.statusUrl ?? brand.appUrl);
			return {
				subject: `Incident: ${title}`,
				body: `We're investigating an issue affecting ${affected}.`,
				actionUrl: statusUrl,
			};
		},
	},
} satisfies Record<string, EventTemplate<IncidentPayload>>;

export const systemIncidentTemplates: Record<string, EventTemplate<IncidentPayload>> = langs;
