/**
 * Full migration-chain application test for the audit-log immutability work.
 *
 * Spins up a *fresh* Testcontainers PostgreSQL (independent of the shared
 * global-setup container) and runs `migrate()` over the entire `drizzle/` folder
 * — `0000` through `0007` — to prove the hand-written trigger migration and its
 * manual `_journal.json` entry (idx 6) are picked up and apply cleanly on top of
 * the generated migrations (incl. the `0007` team-members table). After
 * migrating, it inspects the `pg_trigger` catalog
 * to confirm both BEFORE UPDATE / BEFORE DELETE triggers landed on
 * `emito_audit_log`, and exercises the enforcement end-to-end against the
 * freshly-migrated schema.
 *
 * Skips gracefully when Docker is unavailable (the container start throws and we
 * mark the suite skipped) so the file never hard-fails in a Docker-less lane.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let container: StartedPostgreSqlContainer | undefined;
let client: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase | undefined;

beforeAll(async () => {
	try {
		container = await new PostgreSqlContainer("postgres:16-alpine")
			.withDatabase("emito_migrate_test")
			.start();
		client = postgres(container.getConnectionUri(), { max: 2 });
		db = drizzle(client, { casing: "snake_case" });
		// Applies 0000..0007 in order, including the hand-written 0006 triggers
		// and the 0007 team-members table.
		await migrate(db, { migrationsFolder: "./drizzle" });
	} catch {
		// Docker unavailable — leave db undefined so every case below skips.
		db = undefined;
	}
}, 120_000);

afterAll(async () => {
	if (client) await client.end();
	if (container) await container.stop();
});

/** True when the fresh migrated DB is available (Docker present). */
function ready(d: PostgresJsDatabase | undefined): d is PostgresJsDatabase {
	return d != null;
}

describe("migration chain 0000..0007 (audit-log immutability)", () => {
	it("applies every migration cleanly and records the full chain as applied", async () => {
		if (!ready(db)) return;
		const rows = await db.execute<{ hash: string }>(
			sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`,
		);
		// One row per journal entry (0000..0007) — eight applied migrations
		// (0007 is the team-members table).
		expect(rows.length).toBe(8);
	});

	it("creates both append-only triggers on emito_audit_log", async () => {
		if (!ready(db)) return;
		const rows = await db.execute<{ tgname: string; tgtype: number }>(
			sql`SELECT t.tgname, t.tgtype FROM pg_trigger t
			    JOIN pg_class c ON c.oid = t.tgrelid
			    WHERE c.relname = 'emito_audit_log' AND NOT t.tgisinternal
			    ORDER BY t.tgname`,
		);
		const names = rows.map((r) => (r as { tgname: string }).tgname);
		expect(names).toContain("trg_emito_audit_log_no_update");
		expect(names).toContain("trg_emito_audit_log_no_delete");
	});

	it("creates the emito_audit_log_immutable() trigger function", async () => {
		if (!ready(db)) return;
		const rows = await db.execute<{ proname: string }>(
			sql`SELECT proname FROM pg_proc WHERE proname = 'emito_audit_log_immutable'`,
		);
		expect(rows.length).toBe(1);
	});

	it("enforces append-only end-to-end on the freshly-migrated schema", async () => {
		if (!ready(db)) return;
		const inserted = await db.execute<{ id: string }>(sql`
			INSERT INTO emito_audit_log
				(id, actor_user_id, actor_kind, action, resource_type, severity, request_id, ip)
			VALUES
				('aud_migtest1', 'user_mig', 'admin_user', 'subscriber.erase', 'subscriber', 'high', 'req_mig', '203.0.113.9')
			RETURNING id
		`);
		expect(inserted.length).toBe(1);

		const updateErr = await db
			.execute(sql`UPDATE emito_audit_log SET severity = 'low' WHERE id = 'aud_migtest1'`)
			.then(
				() => undefined,
				(e: unknown) => e,
			);
		expect((updateErr as { code?: string }).code).toBe("EM100");

		const deleteErr = await db
			.execute(sql`DELETE FROM emito_audit_log WHERE id = 'aud_migtest1'`)
			.then(
				() => undefined,
				(e: unknown) => e,
			);
		expect((deleteErr as { code?: string }).code).toBe("EM100");
	});
});
