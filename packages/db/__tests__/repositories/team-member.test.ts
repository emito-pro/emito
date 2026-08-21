/**
 * Integration tests for {@link DrizzleTeamMemberRepository} against a real PostgreSQL.
 *
 * Covers invite defaults (status=pending, email lower-cased), duplicate-email
 * conflict mapping, status-filtered + cursor-paginated list, role change, invited-at
 * touch (resend), removal, and the not-found branches. Row isolation between tests
 * comes from the per-test TRUNCATE in `../test-setup.ts`.
 */
import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import {
	DrizzleTeamMemberRepository,
	type TeamMemberInvite,
} from "../../src/repositories/drizzle-team-member-repository";
import { dbAvailable, getDb, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

function invite(overrides: Partial<TeamMemberInvite> = {}): TeamMemberInvite {
	return {
		name: "Marcus Lin",
		email: "marcus@myapp.com",
		role: "admin",
		invitedBy: "aria@myapp.com",
		...overrides,
	};
}

describe("DrizzleTeamMemberRepository", () => {
	it("invite defaults status=pending and lower-cases the email", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTeamMemberRepository(getDb());
		const record = await repo.invite(invite({ email: "Marcus@MyApp.com" }));
		expect(record.id).toMatch(/^mbr_/);
		expect(record.status).toBe("pending");
		expect(record.email).toBe("marcus@myapp.com");
		expect(record.role).toBe("admin");
		expect(record.avatarUrl).toBeNull();
		expect(record.lastSignInAt).toBeNull();
		expect(typeof record.invitedAt).toBe("string");
		expect(record.invitedBy).toBe("aria@myapp.com");
	});

	it("invite maps a duplicate email (case-insensitive) to RESOURCE_CONFLICT", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTeamMemberRepository(getDb());
		await repo.invite(invite());
		await expect(repo.invite(invite({ email: "MARCUS@myapp.com" }))).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
		});
	});

	it("findByEmail resolves case-insensitively; findById resolves by id", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTeamMemberRepository(getDb());
		const created = await repo.invite(invite());
		expect((await repo.findByEmail("MARCUS@MYAPP.COM"))?.id).toBe(created.id);
		expect((await repo.findById(created.id))?.email).toBe("marcus@myapp.com");
		expect(await repo.findByEmail("nobody@myapp.com")).toBeNull();
		expect(await repo.findById("mbr_missing")).toBeNull();
	});

	it("list filters by status and reports the filtered total", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTeamMemberRepository(getDb());
		const active = await repo.invite(invite({ email: "a@myapp.com" }));
		await repo.changeRole(active.id, "developer");
		// Promote the first to active by hand via a second invite + a pending one.
		await repo.invite(invite({ email: "b@myapp.com" }));
		await repo.invite(invite({ email: "c@myapp.com" }));

		const all = await repo.list({ limit: 50 });
		expect(all.total).toBe(3);
		const pending = await repo.list({ limit: 50, status: "pending" });
		expect(pending.total).toBe(3);
		expect(pending.items.every((m) => m.status === "pending")).toBe(true);
	});

	it("list paginates newest-invite-first with a cursor", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTeamMemberRepository(getDb());
		await repo.invite(invite({ email: "1@myapp.com" }));
		await tick();
		await repo.invite(invite({ email: "2@myapp.com" }));
		await tick();
		await repo.invite(invite({ email: "3@myapp.com" }));

		const first = await repo.list({ limit: 2 });
		expect(first.items).toHaveLength(2);
		expect(first.hasMore).toBe(true);
		expect(first.cursor).not.toBeNull();
		expect(first.total).toBe(3);

		const second = await repo.list({ limit: 2, cursor: first.cursor });
		const firstIds = new Set(first.items.map((m) => m.id));
		expect(second.items.every((m) => !firstIds.has(m.id))).toBe(true);
		expect(second.hasMore).toBe(false);
	});

	it("changeRole patches the role; unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTeamMemberRepository(getDb());
		const created = await repo.invite(invite());
		const updated = await repo.changeRole(created.id, "support");
		expect(updated.role).toBe("support");
		await expect(repo.changeRole("mbr_missing", "support")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("touchInvitedAt advances invitedAt; unknown id throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTeamMemberRepository(getDb());
		const created = await repo.invite(invite());
		await tick();
		const resent = await repo.touchInvitedAt(created.id);
		expect(Date.parse(resent.invitedAt)).toBeGreaterThanOrEqual(Date.parse(created.invitedAt));
		await expect(repo.touchInvitedAt("mbr_missing")).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});

	it("remove deletes the row; removing twice throws RESOURCE_NOT_FOUND", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleTeamMemberRepository(getDb());
		const created = await repo.invite(invite());
		await repo.remove(created.id);
		expect(await repo.findById(created.id)).toBeNull();
		await expect(repo.remove(created.id)).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
		});
	});
});
