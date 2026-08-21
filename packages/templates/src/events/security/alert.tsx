/**
 * security.alert — Critical security alert (all channels).
 *
 * Channels: email, sms, push, inApp, slack, telegram
 * Payload: { description?: string, secureUrl?: string, device?: string, location?: string, ip?: string, time?: string }
 */

import type { BrandTheme, EventTemplate, RenderContext, SecurityAlertPayload } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { formatSlackBlocks } from "../../formatters/slack";
import { formatTelegramHtml } from "../../formatters/telegram";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface SecurityAlertEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	description: string;
	secureUrl: string;
	strings: {
		heading: string;
		body: string;
		cta: string;
	};
}

function SecurityAlertEmail({
	brand,
	ctx,
	description,
	secureUrl,
	strings,
}: SecurityAlertEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={`${strings.heading}: ${description}`}>
			<Heading
				style={{ fontSize: "24px", margin: "0 0 16px 0", color: THEME_DEFAULTS.dangerColor }}
			>
				{strings.heading}
			</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>{description}</Text>
			<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={secureUrl}
					style={{
						backgroundColor: THEME_DEFAULTS.dangerColor,
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
	heading: "Security Alert",
	body: "We recommend you take immediate action to secure your account.",
	cta: "Secure Account",
	defaultDescription: "Suspicious activity detected",
	deviceLabel: "Device",
	locationLabel: "Location",
	ipLabel: "IP",
	timeLabel: "Time",
	sentVia: "Sent via",
};

const langs = {
	en: {
		email: async (payload: SecurityAlertPayload, brand: BrandTheme, ctx: RenderContext) => {
			const description = payload.description ?? enStrings.defaultDescription;
			const secureUrl = payload.secureUrl ?? `${brand.appUrl}/security`;
			const html = await render(
				<SecurityAlertEmail
					brand={brand}
					ctx={ctx}
					description={description}
					secureUrl={secureUrl}
					strings={enStrings}
				/>,
			);
			const text = `Security alert: ${description}\n\n${enStrings.body}\n\n${enStrings.cta}: ${secureUrl}`;
			return { subject: `Security alert: ${description}`, html, text };
		},
		sms: (payload: SecurityAlertPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const description = payload.description ?? "Suspicious activity";
			const secureUrl = payload.secureUrl ?? "";
			const raw = `${brand.name}: Security alert — ${description}. Secure: ${secureUrl}`;
			return { body: raw.length > 160 ? `${raw.slice(0, 157)}...` : raw };
		},
		push: (payload: SecurityAlertPayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			title: enStrings.heading,
			body: payload.description ?? enStrings.defaultDescription,
		}),
		inApp: (payload: SecurityAlertPayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			subject: enStrings.heading,
			body: payload.description ?? enStrings.defaultDescription,
			actionUrl: "/security",
		}),
		slack: (payload: SecurityAlertPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const description = payload.description ?? enStrings.defaultDescription;
			const secureUrl = payload.secureUrl ?? `${brand.appUrl}/security`;

			const fields: Array<{ label: string; value: string }> = [];
			if (payload.device) fields.push({ label: enStrings.deviceLabel, value: payload.device });
			if (payload.location)
				fields.push({ label: enStrings.locationLabel, value: payload.location });
			if (payload.ip) fields.push({ label: enStrings.ipLabel, value: payload.ip });
			if (payload.time) fields.push({ label: enStrings.timeLabel, value: payload.time });

			return formatSlackBlocks({
				header: enStrings.heading,
				body: description,
				fields: fields.length > 0 ? fields : undefined,
				buttonText: enStrings.cta,
				buttonUrl: secureUrl,
				buttonStyle: "danger",
				contextText: `${enStrings.sentVia} *${brand.name}* notifications`,
			});
		},
		telegram: (payload: SecurityAlertPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const description = payload.description ?? enStrings.defaultDescription;
			const secureUrl = payload.secureUrl ?? `${brand.appUrl}/security`;

			const fields: Array<{ label: string; value: string }> = [];
			if (payload.device) fields.push({ label: enStrings.deviceLabel, value: payload.device });
			if (payload.location)
				fields.push({ label: enStrings.locationLabel, value: payload.location });
			if (payload.ip)
				fields.push({ label: enStrings.ipLabel, value: `<code>${payload.ip}</code>` });

			return formatTelegramHtml({
				title: `🚨 ${enStrings.heading}`,
				body: description,
				fields: fields.length > 0 ? fields : undefined,
				linkText: enStrings.cta,
				linkUrl: secureUrl,
			});
		},
	},
} satisfies Record<string, EventTemplate<SecurityAlertPayload>>;

export const securityAlertTemplates: Record<string, EventTemplate<SecurityAlertPayload>> = langs;
