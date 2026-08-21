import type { ApiPage } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { emito_team_members } from "../schema/team-members";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";

/**
 * A team-member role (capability tier). `owner` is the seat-of-one founder role;
 * the rest are assignable via invite / change-role.
 */
export type TeamMemberRole = "owner" | "admin" | "developer" | "analyst" | "support";

/** Whether a member has accepted their invitation (`active`) or is still `pending`. */
export type TeamMemberStatus = "active" | "pending";

/**
 * One persisted team member, projected to the admin wire shape.
 *
 * Timestamps are ISO-8601 strings (the wire form); `lastSignInAt` / `avatarUrl`
 * are `null` for an invitee who has never signed in / has no avatar.
 */
export interface TeamMemberRecord {
	readonly id: string;
	readonly name: string;
	readonly email: string;
	readonly role: TeamMemberRole;
	readonly status: TeamMemberStatus;
	readonly avatarUrl: string | null;
	readonly lastSignInAt: string | null;
	readonly invitedAt: string;
	readonly invitedBy: string;
}

/** Payload for {@link TeamMemberRepository.invite}. */
export interface TeamMemberInvite {
	readonly name: string;
	readonly email: string;
	readonly role: TeamMemberRole;
	/** Stable id of the inviting principal (recorded as `invitedBy`). */
	readonly invitedBy: string;
}

/**
 * Persistence contract for the team-member invitation lifecycle.
 *
 * Defined here (rather than in `@emito/core`) because team management is an
 * admin-owned surface — the shared notification platform has no concept of
 * workspace members. The admin endpoint layer depends on this contract; the
 * Drizzle class below is its production implementation. Write methods accept an
 * optional opaque transaction handle so the mutation can join the endpoint's
 * audit-log transaction (an audit failure then rolls the change back).
 */
export interface TeamMemberRepository {
	/** Cursor-paginated roster, newest-invite-first. */
	list(opts: { cursor?: string | null; limit: number; status?: TeamMemberStatus }): Promise<
		ApiPage<TeamMemberRecord>
	>;
	/** Resolve a member by id, or `null` when absent. */
	findById(id: string): Promise<TeamMemberRecord | null>;
	/** Resolve a member by (lower-cased) email, or `null` when absent. */
	findByEmail(email: string): Promise<TeamMemberRecord | null>;
	/** Create a `pending` invitation. A duplicate email → `RESOURCE_CONFLICT`. */
	invite(input: TeamMemberInvite, tx?: unknown): Promise<TeamMemberRecord>;
	/** Change a member's role. Unknown id → `RESOURCE_NOT_FOUND`. */
	changeRole(id: string, role: TeamMemberRole, tx?: unknown): Promise<TeamMemberRecord>;
	/** Touch `invitedAt` so a resent invitation reflects a fresh send time. */
	touchInvitedAt(id: string, tx?: unknown): Promise<TeamMemberRecord>;
	/** Remove a member / revoke an invitation. Unknown id → `RESOURCE_NOT_FOUND`. */
	remove(id: string, tx?: unknown): Promise<void>;
}

/**
 * Drizzle implementation of {@link TeamMemberRepository}.
 *
 * `list` over-fetches `limit + 1` rows ordered by `invitedAt` descending (then `id`
 * for a stable tiebreak) and runs a gated `COUNT(*)` for `total`, matching the
 * admin-pagination idiom the other admin repositories use. `invite` relies on
 * the unique `email` index — a duplicate insert is caught and re-mapped to
 * `RESOURCE_CONFLICT` rather than leaking the raw Postgres constraint error. Write
 * methods route through the supplied transaction handle when present so the
 * mutation joins the endpoint's audit transaction.
 */
export class DrizzleTeamMemberRepository implements TeamMemberRepository {
	constructor(private readonly db: DrizzleDb) {}

	async list(opts: {
		cursor?: string | null;
		limit: number;
		status?: TeamMemberStatus;
	}): Promise<ApiPage<TeamMemberRecord>> {
		const limit = normalizeAdminLimit(opts.limit);
		const cursorDate = decodeAdminCursorDate(opts.cursor);
		const where = this.buildWhere(opts.status, cursorDate);

		const rows = await this.db
			.select()
			.from(emito_team_members)
			.where(where)
			.orderBy(desc(emito_team_members.invitedAt), asc(emito_team_members.id))
			.limit(limit + 1);

		const total = await this.count(opts.status);
		return buildAdminPage(
			rows.map((r) => this.mapRow(r)),
			limit,
			total,
			(r) => new Date(r.invitedAt),
		);
	}

	async findById(id: string): Promise<TeamMemberRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_team_members)
			.where(eq(emito_team_members.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async findByEmail(email: string): Promise<TeamMemberRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_team_members)
			.where(eq(emito_team_members.email, email.toLowerCase()))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async invite(input: TeamMemberInvite, tx?: unknown): Promise<TeamMemberRecord> {
		const executor = (tx as DrizzleDb | undefined) ?? this.db;
		try {
			const [row] = await executor
				.insert(emito_team_members)
				.values({
					name: input.name,
					email: input.email.toLowerCase(),
					role: input.role,
					status: "pending",
					invitedBy: input.invitedBy,
				})
				.returning();
			return this.mapRow(row);
		} catch (err) {
			if (isUniqueViolation(err)) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
					message: `${input.email} is already a team member`,
					isRetryable: false,
					context: { email: input.email },
					cause: err instanceof Error ? err : undefined,
				});
			}
			throw err;
		}
	}

	async changeRole(id: string, role: TeamMemberRole, tx?: unknown): Promise<TeamMemberRecord> {
		const executor = (tx as DrizzleDb | undefined) ?? this.db;
		const [row] = await executor
			.update(emito_team_members)
			.set({ role, updatedAt: new Date() })
			.where(eq(emito_team_members.id, id))
			.returning();
		if (!row) throw this.notFound(id);
		return this.mapRow(row);
	}

	async touchInvitedAt(id: string, tx?: unknown): Promise<TeamMemberRecord> {
		const executor = (tx as DrizzleDb | undefined) ?? this.db;
		const now = new Date();
		const [row] = await executor
			.update(emito_team_members)
			.set({ invitedAt: now, updatedAt: now })
			.where(eq(emito_team_members.id, id))
			.returning();
		if (!row) throw this.notFound(id);
		return this.mapRow(row);
	}

	async remove(id: string, tx?: unknown): Promise<void> {
		const executor = (tx as DrizzleDb | undefined) ?? this.db;
		const [row] = await executor
			.delete(emito_team_members)
			.where(eq(emito_team_members.id, id))
			.returning({ id: emito_team_members.id });
		if (!row) throw this.notFound(id);
	}

	private notFound(id: string): EmitoError {
		return new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
			message: `Team member ${id} not found`,
			isRetryable: false,
			context: { id },
		});
	}

	private async count(status?: TeamMemberStatus): Promise<number> {
		const where = this.buildWhere(status, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_team_members)
			.where(where);
		return row?.value ?? 0;
	}

	private buildWhere(status: TeamMemberStatus | undefined, cursorDate: Date | undefined) {
		const conditions = [];
		if (status !== undefined) conditions.push(eq(emito_team_members.status, status));
		if (cursorDate !== undefined) conditions.push(lt(emito_team_members.invitedAt, cursorDate));
		if (conditions.length === 0) return undefined;
		return and(...conditions);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): TeamMemberRecord {
		return {
			id: row.id,
			name: row.name,
			email: row.email,
			role: row.role as TeamMemberRole,
			status: row.status as TeamMemberStatus,
			avatarUrl: row.avatarUrl ?? null,
			lastSignInAt: row.lastSignInAt ? new Date(row.lastSignInAt).toISOString() : null,
			invitedAt: new Date(row.invitedAt).toISOString(),
			invitedBy: row.invitedBy,
		};
	}
}

/** Narrow an unknown thrown value to a Postgres unique-violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
	return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}
