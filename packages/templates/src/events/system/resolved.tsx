/**
 * system.resolved — Incident resolution notification across email, push, in-app.
 *
 * Channels: email, push, inApp
 * Payload: { title?: string, summary?: string, resolutionSummary?: string }
 */

import type { BrandTheme, EventTemplate, RenderContext, ResolvedPayload } from "@emito/types";
import { Heading, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface ResolvedEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	strings: {
		heading: string;
		body: string;
	};
}

function ResolvedEmail({ brand, ctx, strings }: ResolvedEmailProps) {
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
	heading: "Incident Resolved",
	pushTitle: "Resolved",
	inAppSubject: "Incident resolved",
};

const langs = {
	en: {
		email: async (payload: ResolvedPayload, brand: BrandTheme, ctx: RenderContext) => {
			const title = String(payload.title ?? "");
			const summary = String(payload.resolutionSummary ?? payload.summary ?? "");
			const strings = {
				heading: enStrings.heading,
				body: `${title} has been resolved. ${summary}`,
			};
			const html = await render(<ResolvedEmail brand={brand} ctx={ctx} strings={strings} />);
			const text = `${strings.heading}\n\n${strings.body}`;
			return { subject: `Resolved: ${title}`, html, text };
		},
		push: (payload: ResolvedPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const title = String(payload.title ?? "");
			return {
				title: enStrings.pushTitle,
				body: `${title} has been resolved.`,
			};
		},
		inApp: (payload: ResolvedPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const title = String(payload.title ?? "");
			return {
				subject: enStrings.inAppSubject,
				body: `${title} resolved. All systems operational.`,
			};
		},
	},
} satisfies Record<string, EventTemplate<ResolvedPayload>>;

export const systemResolvedTemplates: Record<string, EventTemplate<ResolvedPayload>> = langs;
