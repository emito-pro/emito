/**
 * Shared test harness for the admin new-table schema round-trip tests.
 *
 * Spins up a Drizzle client against the Testcontainers PostgreSQL instance
 * provided by `global-setup.ts` (injected as `DB_URI`), applies every migration
 * (including `0002_*`), and exposes typed helpers used by each per-table suite.
 *
 * When Docker is unavailable, `DB_URI` is the empty string and `getDb()` returns
 * `undefined`; suites guard on `hasDb()` and skip gracefully so the file never
 * fails in a Docker-less CI lane.
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { inject } from "vitest";

/** Untyped Drizzle client matching the `casing: "snake_case"` config used in production. */
export type TestDb = ReturnType<typeof drizzle>;

let pgClient: ReturnType<typeof postgres> | undefined;
let dbInstance: TestDb | undefined;

/**
 * Lazily connect + migrate. Safe to call from each suite's `beforeAll`; the
 * connection and migration run exactly once per worker. Returns `undefined`
 * when Docker (hence `DB_URI`) is unavailable.
 */
export async function getDb(): Promise<TestDb | undefined> {
	if (dbInstance) return dbInstance;

	const uri = inject("DB_URI");
	if (!uri) return undefined;

	pgClient = postgres(uri, { max: 5 });
	dbInstance = drizzle(pgClient, { casing: "snake_case" });
	await migrate(dbInstance, { migrationsFolder: "./drizzle" });
	return dbInstance;
}

/** Tear down the shared connection. Call from each suite's `afterAll`. */
export async function closeDb(): Promise<void> {
	if (pgClient) {
		await pgClient.end();
		pgClient = undefined;
		dbInstance = undefined;
	}
}

/** True when a live DB connection is available (Docker present). */
export function hasDb(db: TestDb | undefined): db is TestDb {
	return db != null;
}

/**
 * Return the first element of a result set, narrowing the type from `T | undefined`
 * to `T`. Throws a descriptive error if the set is empty — used after inserts/selects
 * that are expected to return exactly one row, so strict-mode narrowing holds without
 * a non-null assertion.
 */
export function firstRow<T>(rows: readonly T[], label = "row"): T {
	const row = rows[0];
	if (row === undefined) {
		throw new Error(`Expected at least one ${label}, got none`);
	}
	return row;
}

/**
 * Run `EXPLAIN` on a query and return the flattened plan text. Used to assert a
 * named index is chosen for a lookup. `SET enable_seqscan = off` is applied for
 * the EXPLAIN so the planner prefers the index even on the tiny test dataset
 * (where a seq scan would otherwise win on row count).
 */
export async function explain(db: TestDb, query: string): Promise<string> {
	await db.execute(sql.raw("SET enable_seqscan = off"));
	const rows = await db.execute<{ "QUERY PLAN": string }>(sql.raw(`EXPLAIN ${query}`));
	const text = rows.map((r) => (r as Record<string, string>)["QUERY PLAN"]).join("\n");
	await db.execute(sql.raw("SET enable_seqscan = on"));
	return text;
}

/** Insert a host-app subscriber (no Emito-generated prefix) for FK-free fixtures. */
let listSeq = 0;
/**
 * Insert a minimal `emito_lists` row and return its generated `lst_` id. Used by
 * the broadcasts suite, whose `list_id` FK requires a real parent list row.
 */
export async function insertList(db: TestDb): Promise<string> {
	listSeq += 1;
	const slug = `list-fixture-${Date.now()}-${listSeq}`;
	const rows = await db.execute<{ id: string }>(sql`
		INSERT INTO emito_lists (id, name, slug)
		VALUES (${`lst_${slug.replace(/-/g, "")}`}, ${slug}, ${slug})
		RETURNING id
	`);
	return (rows[0] as { id: string }).id;
}
