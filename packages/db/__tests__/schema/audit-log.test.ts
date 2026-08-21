/**
 * Round-trip + index + immutability tests for `emito_audit_log`.
 *
 * Verifies: prefixed-id generation (`aud_`), nullable before/after state,
 * metadata default, the `no_delete_audit_log` CHECK placeholder exists, the
 * (resource_type, resource_id, created_at DESC) lookup uses its index, and the
 * partial high-severity index is present.
 *
 * Also verifies the database-level append-only enforcement (migration
 * `0006_audit_log_immutability.sql`): INSERT succeeds, UPDATE of any column
 * raises with SQLSTATE `EM100`, DELETE raises with `EM100`, and `TRUNCATE`
 * still succeeds (row triggers do not fire on the statement-level TRUNCATE —
 * which is exactly what keeps the per-test `TRUNCATE ... CASCADE` isolation
 * reset working; asserted explicitly so nobody "fixes" it later).
 *
 * Runs against the Testcontainers PostgreSQL from global-setup.ts; skips when
 * Docker is unavailable.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emito_audit_log } from "../../src/schema/audit-log";
import { type TestDb, closeDb, explain, firstRow, getDb, hasDb } from "./_helpers";

let db: TestDb | undefined;

beforeAll(async () => {
	db = await getDb();
}, 60_000);

afterAll(async () => {
	await closeDb();
});

function auditEntry(overrides: Record<string, unknown> = {}) {
	return {
		actorUserId: `user_aud_${Date.now()}`,
		actorKind: "admin_user",
		action: "subscriber.erase",
		resourceType: "subscriber",
		resourceId: `user_target_${Date.now()}`,
		severity: "high",
		requestId: `req_${Date.now()}`,
		ip: "203.0.113.7",
		...overrides,
	};
}

describe("emito_audit_log", () => {
	it("generates an aud_ prefixed id and round-trips before/after state", async () => {
		if (!hasDb(db)) return;
		const before = { status: "active" };
		const after = { status: "erased" };

		const inserted = firstRow(
			await db
				.insert(emito_audit_log)
				.values(auditEntry({ beforeState: before, afterState: after }))
				.returning(),
		);

		expect(inserted.id).toMatch(/^aud_/);

		const found = firstRow(
			await db.select().from(emito_audit_log).where(eq(emito_audit_log.id, inserted.id)),
		);

		expect(found.beforeState).toEqual(before);
		expect(found.afterState).toEqual(after);
		expect(found.action).toBe("subscriber.erase");
	});

	it("allows null before/after state for bulk ops and defaults metadata to {}", async () => {
		if (!hasDb(db)) return;
		const inserted = firstRow(
			await db
				.insert(emito_audit_log)
				.values(auditEntry({ resourceId: null, action: "dead_letter.bulk_retry" }))
				.returning(),
		);

		expect(inserted.resourceId).toBeNull();
		expect(inserted.beforeState).toBeNull();
		expect(inserted.afterState).toBeNull();
		expect(inserted.metadata).toEqual({});
	});

	it("uses the (resource_type, resource_id, created_at DESC) index for resource lookups", async () => {
		if (!hasDb(db)) return;
		await db.insert(emito_audit_log).values(auditEntry({ resourceId: "user_explain" }));

		const plan = await explain(
			db,
			"SELECT * FROM emito_audit_log WHERE resource_type = 'subscriber' AND resource_id = 'user_explain' ORDER BY created_at DESC",
		);
		expect(plan).toContain("idx_emito_aud_resource");
	});

	it("has the partial high-severity index", async () => {
		if (!hasDb(db)) return;
		const rows = await db.execute<{ indexdef: string }>(
			sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_emito_aud_high_severity'`,
		);
		const def = (rows[0] as { indexdef: string } | undefined)?.indexdef ?? "";
		expect(def.toLowerCase()).toContain("where");
		expect(def).toContain("'high'");
	});

	it("has the no_delete_audit_log CHECK constraint placeholder", async () => {
		if (!hasDb(db)) return;
		const rows = await db.execute<{ conname: string }>(
			sql`SELECT conname FROM pg_constraint WHERE conname = 'no_delete_audit_log'`,
		);
		expect(rows.length).toBe(1);
	});

	it("filters by actor via the actor index", async () => {
		if (!hasDb(db)) return;
		const actor = `user_actor_${Date.now()}`;
		await db.insert(emito_audit_log).values(auditEntry({ actorUserId: actor }));

		const found = await db
			.select()
			.from(emito_audit_log)
			.where(eq(emito_audit_log.actorUserId, actor));
		expect(found.length).toBeGreaterThanOrEqual(1);
	});

	describe("append-only enforcement (triggers)", () => {
		/** The SQLSTATE the immutability function raises with — see migration 0006. */
		const IMMUTABLE_ERRCODE = "EM100";
		// Must match the RAISE EXCEPTION text in migration 0006 verbatim — this
		// asserts the live trigger message, so it is intentionally kept byte-identical.
		const IMMUTABLE_MESSAGE = "emito_audit_log is append-only (008d immutability trigger)";

		/** Insert one audit row and return its generated id, for mutation attempts. */
		async function seedRow(database: TestDb): Promise<string> {
			const inserted = firstRow(
				await database.insert(emito_audit_log).values(auditEntry()).returning(),
			);
			return inserted.id;
		}

		it("both BEFORE UPDATE and BEFORE DELETE triggers exist on the table", async () => {
			if (!hasDb(db)) return;
			const rows = await db.execute<{ tgname: string }>(
				sql`SELECT t.tgname FROM pg_trigger t
				    JOIN pg_class c ON c.oid = t.tgrelid
				    WHERE c.relname = 'emito_audit_log' AND NOT t.tgisinternal
				    ORDER BY t.tgname`,
			);
			const names = rows.map((r) => (r as { tgname: string }).tgname);
			expect(names).toContain("trg_emito_audit_log_no_update");
			expect(names).toContain("trg_emito_audit_log_no_delete");
		});

		it("allows INSERT (the append path stays open)", async () => {
			if (!hasDb(db)) return;
			await expect(
				db.insert(emito_audit_log).values(auditEntry()).returning(),
			).resolves.toHaveLength(1);
		});

		it("rejects UPDATE of any column with SQLSTATE EM100", async () => {
			if (!hasDb(db)) return;
			const id = await seedRow(db);

			const err = await db
				.update(emito_audit_log)
				.set({ severity: "low" })
				.where(eq(emito_audit_log.id, id))
				.then(
					() => undefined,
					(e: unknown) => e,
				);

			expect(err).toBeInstanceOf(Error);
			expect((err as { code?: string }).code).toBe(IMMUTABLE_ERRCODE);
			expect((err as Error).message).toContain(IMMUTABLE_MESSAGE);

			// The row is unchanged — the BEFORE trigger aborts before the write.
			const found = firstRow(
				await db.select().from(emito_audit_log).where(eq(emito_audit_log.id, id)),
			);
			expect(found.severity).toBe("high");
		});

		it("rejects UPDATE even of a free-form column (metadata) with SQLSTATE EM100", async () => {
			if (!hasDb(db)) return;
			const id = await seedRow(db);

			const err = await db
				.update(emito_audit_log)
				.set({ metadata: { tampered: true } })
				.where(eq(emito_audit_log.id, id))
				.then(
					() => undefined,
					(e: unknown) => e,
				);

			expect((err as { code?: string }).code).toBe(IMMUTABLE_ERRCODE);
		});

		it("rejects DELETE with SQLSTATE EM100", async () => {
			if (!hasDb(db)) return;
			const id = await seedRow(db);

			const err = await db
				.delete(emito_audit_log)
				.where(eq(emito_audit_log.id, id))
				.then(
					() => undefined,
					(e: unknown) => e,
				);

			expect(err).toBeInstanceOf(Error);
			expect((err as { code?: string }).code).toBe(IMMUTABLE_ERRCODE);
			expect((err as Error).message).toContain(IMMUTABLE_MESSAGE);

			// The row survives the rejected delete.
			const found = await db.select().from(emito_audit_log).where(eq(emito_audit_log.id, id));
			expect(found).toHaveLength(1);
		});

		it("still allows TRUNCATE — row triggers do not fire on statement-level TRUNCATE", async () => {
			// CRITICAL: per-test isolation in test-setup.ts is `TRUNCATE ... CASCADE`.
			// The append-only enforcement is intentionally row-level (BEFORE UPDATE/DELETE
			// FOR EACH ROW), so TRUNCATE bypasses it. If anyone ever adds a
			// `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger, this test fails and the
			// whole db test isolation breaks — that is the point of asserting it here.
			if (!hasDb(db)) return;
			await seedRow(db);

			await expect(
				db.execute(sql`TRUNCATE TABLE emito_audit_log CASCADE`),
			).resolves.not.toThrow();

			const remaining = await db.select().from(emito_audit_log);
			expect(remaining).toHaveLength(0);
		});
	});
});
