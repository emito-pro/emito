import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

/**
 * Workspace team members and their invitation lifecycle.
 *
 * Emito delegates identity (users / passwords) to the embedding host — there is
 * no users table here. What an admin surface *does* own is the invitation-lifecycle
 * state: who has been invited, in what role, whether they have accepted (`active`)
 * or are still `pending`, who invited them, and when. That state has no home in the
 * shared notification-platform tables, so it lives here as an admin-owned table
 * (the same posture the template gallery and webhook catalog take for their
 * built-in data).
 *
 * Columns mirror the admin wire shape field-for-field (`id` / `name` / `email` /
 * `role` / `status` / `avatarUrl` / `lastSignInAt` / `invitedAt` / `invitedBy`).
 * `email` is unique (lower-cased at the repository
 * boundary) so a second invite to the same address is a clean `RESOURCE_CONFLICT`
 * rather than a duplicate row. `lastSignInAt` and `avatarUrl` are nullable — an
 * invitee who has never signed in / has no uploaded avatar.
 *
 * `role` / `status` are stored as `text` (validated at the API boundary) to match
 * the rest of the admin tables, which favour app-level enums over Postgres
 * enum types for migration ergonomics.
 */
export const emito_team_members = pgTable(
	"emito_team_members",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.teamMember)),
		name: text().notNull(),
		email: text().notNull(),
		role: text().notNull(),
		status: text().notNull().default("pending"),
		avatarUrl: text(),
		lastSignInAt: timestamp({ withTimezone: true }),
		invitedAt: timestamp({ withTimezone: true }).notNull().default(sql`now()`),
		invitedBy: text().notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [unique("emito_team_members_email_unique").on(table.email)],
);
