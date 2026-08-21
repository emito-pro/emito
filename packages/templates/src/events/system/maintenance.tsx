/**
 * system.maintenance — Scheduled maintenance notification across email, push, in-app.
 *
 * Channels: email, push, inApp
 * Payload: { date?: string, duration?: string, affected?: string, affectedServices?: string }
 */

import type { BrandTheme, EventTemplate, MaintenancePayload, RenderContext } from "@emito/types";
import { Heading, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface MaintenanceEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	strings: {
		heading: string;
		body: string;
	};
}

function MaintenanceEmail({ brand, ctx, strings }: MaintenanceEmailProps) {
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
	heading: "Scheduled Maintenance",
	pushTitle: "Scheduled Maintenance",
	inAppSubject: "Maintenance scheduled",
};

const langs = {
	en: {
		email: async (payload: MaintenancePayload, brand: BrandTheme, ctx: RenderContext) => {
			const date = String(payload.date ?? "");
			const duration = String(payload.duration ?? "");
			const affected = String(payload.affectedServices ?? payload.affected ?? "");
			const strings = {
				heading: enStrings.heading,
				body: `We have planned maintenance on ${date}. Expected downtime: ${duration}. Affected services: ${affected}.`,
			};
			const html = await render(<MaintenanceEmail brand={brand} ctx={ctx} strings={strings} />);
			const text = `${strings.heading}\n\n${strings.body}`;
			return { subject: `Scheduled maintenance: ${date}`, html, text };
		},
		push: (payload: MaintenancePayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const date = String(payload.date ?? "");
			const duration = String(payload.duration ?? "");
			return {
				title: enStrings.pushTitle,
				body: `${date} — ${duration} expected downtime`,
			};
		},
		inApp: (payload: MaintenancePayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const date = String(payload.date ?? "");
			return {
				subject: enStrings.inAppSubject,
				body: `Planned maintenance on ${date}.`,
			};
		},
	},
} satisfies Record<string, EventTemplate<MaintenancePayload>>;

export const systemMaintenanceTemplates: Record<string, EventTemplate<MaintenancePayload>> = langs;
