/**
 * team.invitation — Team invitation notification.
 *
 * Channels: email, inApp
 * Payload: { team?: string, inviterName?: string, inviteUrl?: string }
 */

import type { BrandTheme, EventTemplate, RenderContext, TeamInvitationPayload } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface InvitationEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	inviteUrl: string;
	strings: {
		heading: string;
		body: string;
		cta: string;
	};
}

function InvitationEmail({ brand, ctx, inviteUrl, strings }: InvitationEmailProps) {
	return (
		<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.heading}>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
			<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={inviteUrl}
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
	heading: "You're invited!",
	body: (inviterName: string, team: string) => `${inviterName} has invited you to join ${team}.`,
	cta: "Accept Invitation",
	subject: (team: string) => `You've been invited to ${team}`,
	inAppSubject: "Team invitation",
	inAppBody: (team: string) => `You've been invited to ${team}.`,
};

const langs = {
	en: {
		email: async (payload: TeamInvitationPayload, brand: BrandTheme, ctx: RenderContext) => {
			const team = payload.team ?? brand.name;
			const inviterName = payload.inviterName ?? "Someone";
			const inviteUrl = payload.inviteUrl ?? brand.appUrl;
			const strings = {
				heading: enStrings.heading,
				body: enStrings.body(inviterName, team),
				cta: enStrings.cta,
			};
			const html = await render(
				<InvitationEmail brand={brand} ctx={ctx} inviteUrl={inviteUrl} strings={strings} />,
			);
			const text = `${strings.heading}\n\n${strings.body}\n\n${strings.cta}: ${inviteUrl}`;
			return { subject: enStrings.subject(team), html, text };
		},
		inApp: (payload: TeamInvitationPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const team = payload.team ?? brand.name;
			const inviteUrl = payload.inviteUrl ?? "/";
			return {
				subject: enStrings.inAppSubject,
				body: enStrings.inAppBody(team),
				actionUrl: inviteUrl,
			};
		},
	},
} satisfies Record<string, EventTemplate<TeamInvitationPayload>>;

export const teamInvitationTemplates: Record<string, EventTemplate<TeamInvitationPayload>> = langs;
