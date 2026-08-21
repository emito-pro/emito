/**
 * auth.login-new-device — New sign-in from unrecognized device.
 *
 * Channels: email, sms, push, inApp
 * Payload: { device?: string, location?: string, ip?: string, time?: string, secureUrl?: string }
 */

import type { BrandTheme, EventTemplate, LoginNewDevicePayload, RenderContext } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { formatDateTime } from "../../formatters/intl";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface LoginNewDeviceEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	device: string;
	location?: string;
	ip?: string;
	formattedTime: string;
	secureUrl: string;
	strings: {
		heading: string;
		intro: string;
		deviceLabel: string;
		locationLabel: string;
		ipLabel: string;
		timeLabel: string;
		cta: string;
	};
}

function LoginNewDeviceEmail({
	brand,
	ctx,
	device,
	location,
	ip,
	formattedTime,
	secureUrl,
	strings,
}: LoginNewDeviceEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.heading}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 8px 0" }}>{strings.intro}</Text>
			<Section
				style={{
					backgroundColor: THEME_DEFAULTS.surfaceColor,
					padding: "16px",
					borderRadius: "8px",
					margin: "0 0 16px 0",
				}}
			>
				<Text style={{ margin: "0 0 4px 0" }}>
					<strong>{strings.deviceLabel}:</strong> {device}
				</Text>
				{location && (
					<Text style={{ margin: "0 0 4px 0" }}>
						<strong>{strings.locationLabel}:</strong> {location}
					</Text>
				)}
				{ip && (
					<Text style={{ margin: "0 0 4px 0" }}>
						<strong>{strings.ipLabel}:</strong> {ip}
					</Text>
				)}
				<Text style={{ margin: "0" }}>
					<strong>{strings.timeLabel}:</strong> {formattedTime}
				</Text>
			</Section>
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
	heading: "New sign-in to your account",
	intro: "We noticed a new sign-in to your account. Here are the details:",
	deviceLabel: "Device",
	locationLabel: "Location",
	ipLabel: "IP Address",
	timeLabel: "Time",
	cta: "Review Activity",
	pushTitle: "New Sign-In",
	defaultDevice: "unknown device",
};

const langs = {
	en: {
		email: async (payload: LoginNewDevicePayload, brand: BrandTheme, ctx: RenderContext) => {
			const device = payload.device ?? "Unknown device";
			const secureUrl = payload.secureUrl ?? `${brand.appUrl}/security`;
			const formattedTime = payload.time ?? formatDateTime(new Date(), ctx);
			const html = await render(
				<LoginNewDeviceEmail
					brand={brand}
					ctx={ctx}
					device={device}
					location={payload.location}
					ip={payload.ip}
					formattedTime={formattedTime}
					secureUrl={secureUrl}
					strings={enStrings}
				/>,
			);
			const parts = [`${enStrings.heading}\n`, `Device: ${device}`];
			if (payload.location) parts.push(`Location: ${payload.location}`);
			if (payload.ip) parts.push(`IP: ${payload.ip}`);
			parts.push("", `Review Activity: ${secureUrl}`);
			return { subject: enStrings.heading, html, text: parts.join("\n") };
		},
		sms: (payload: LoginNewDevicePayload, brand: BrandTheme, _ctx: RenderContext) => {
			const device = payload.device ?? "unknown device";
			const secureUrl = payload.secureUrl ?? "";
			const raw = `${brand.name}: New login from ${device}. Not you? ${secureUrl}`;
			return { body: raw.length > 160 ? `${raw.slice(0, 157)}...` : raw };
		},
		push: (payload: LoginNewDevicePayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const device = payload.device ?? enStrings.defaultDevice;
			const location = payload.location ?? "";
			const body = location ? `Sign-in from ${device} in ${location}` : `Sign-in from ${device}`;
			return { title: enStrings.pushTitle, body };
		},
		inApp: (payload: LoginNewDevicePayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const device = payload.device ?? "unknown device";
			const location = payload.location ?? "";
			const body = location ? `From ${device} in ${location}` : `From ${device}`;
			return {
				subject: "New sign-in detected",
				body,
				actionUrl: "/security",
			};
		},
	},
} satisfies Record<string, EventTemplate<LoginNewDevicePayload>>;

export const loginNewDeviceTemplates: Record<string, EventTemplate<LoginNewDevicePayload>> = langs;
