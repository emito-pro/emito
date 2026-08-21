/**
 * team.role-changed — Team role change notification.
 *
 * Channels: email, inApp
 * Payload: { team?: string, role?: string, oldRole?: string, newRole?: string }
 */

import type {
	BrandTheme,
	EventTemplate,
	RenderContext,
	TeamRoleChangedPayload,
} from "@emito/types";
import { Heading, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";

// ---------------------------------------------------------------------------
// Shared email component
// ---------------------------------------------------------------------------

interface RoleChangedEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	strings: {
		heading: string;
		body: string;
	};
}

function RoleChangedEmail({ brand, ctx, strings }: RoleChangedEmailProps) {
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
	heading: "Role Updated",
	body: (team: string, oldRole: string, newRole: string) =>
		`Your role in ${team} has been changed from ${oldRole} to ${newRole}.`,
	subject: (team: string) => `Your role in ${team} was updated`,
	inAppSubject: "Role updated",
	inAppBody: (team: string, role: string) => `Your role in ${team} changed to ${role}.`,
};

const langs = {
	en: {
		email: async (payload: TeamRoleChangedPayload, brand: BrandTheme, ctx: RenderContext) => {
			const team = payload.team ?? brand.name;
			const oldRole = payload.oldRole ?? "member";
			const newRole = payload.newRole ?? payload.role ?? "member";
			const strings = {
				heading: enStrings.heading,
				body: enStrings.body(team, oldRole, newRole),
			};
			const html = await render(<RoleChangedEmail brand={brand} ctx={ctx} strings={strings} />);
			const text = `${strings.heading}\n\n${strings.body}`;
			return { subject: enStrings.subject(team), html, text };
		},
		inApp: (payload: TeamRoleChangedPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const team = payload.team ?? brand.name;
			const role = payload.role ?? payload.newRole ?? "member";
			return {
				subject: enStrings.inAppSubject,
				body: enStrings.inAppBody(team, role),
			};
		},
	},
} satisfies Record<string, EventTemplate<TeamRoleChangedPayload>>;

export const teamRoleChangedTemplates: Record<
	string,
	EventTemplate<TeamRoleChangedPayload>
> = langs;
