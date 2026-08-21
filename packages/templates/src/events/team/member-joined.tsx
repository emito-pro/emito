/**
 * team.member-joined — Team member joined notification.
 *
 * Channels: inApp
 * Payload: { name?: string, team?: string }
 */

import type {
	BrandTheme,
	EventTemplate,
	RenderContext,
	TeamMemberJoinedPayload,
} from "@emito/types";

const enStrings = {
	subject: (name: string) => `${name} joined`,
	body: (name: string, team: string) => `${name} joined ${team}.`,
};

const langs = {
	en: {
		inApp: (payload: TeamMemberJoinedPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const name = payload.name ?? "Someone";
			const team = payload.team ?? "the team";
			return {
				subject: enStrings.subject(name),
				body: enStrings.body(name, team),
			};
		},
	},
} satisfies Record<string, EventTemplate<TeamMemberJoinedPayload>>;

export const teamMemberJoinedTemplates: Record<
	string,
	EventTemplate<TeamMemberJoinedPayload>
> = langs;
