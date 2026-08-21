/**
 * Shared Testcontainers PostgreSQL harness for the admin-repository integration tests.
 *
 * `global-setup.ts` boots a single PG 16 container and injects `DB_URI`; this helper opens a
 * connection, runs migrations once per test file, and exposes a `getDb()` accessor plus a
 * `dbAvailable()` guard so each file can skip cleanly when Docker is unavailable. Row isolation
 * between tests comes from the per-test TRUNCATE in `../test-setup.ts`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, inject } from "vitest";
import type { DrizzleDb } from "../../src/repositories/db-type";

let pgClient: ReturnType<typeof postgres> | undefined;
let db: DrizzleDb | undefined;

/**
 * Boot the migrated DB connection for the calling test file. Registers `beforeAll`/`afterAll`
 * hooks. When `DB_URI` is empty (Docker unavailable) `db` stays undefined and tests should
 * guard with {@link dbAvailable}.
 */
export function setupAdminTestDb(): void {
	beforeAll(async () => {
		const uri = inject("DB_URI");
		if (!uri) {
			console.warn("DB_URI not injected — Docker unavailable. Skipping integration tests.");
			return;
		}
		pgClient = postgres(uri, { max: 5 });
		db = drizzle(pgClient, { casing: "snake_case" });
		await migrate(db, { migrationsFolder: "./drizzle" });
	}, 60_000);

	afterAll(async () => {
		if (pgClient) await pgClient.end();
		pgClient = undefined;
		db = undefined;
	});
}

/** True when a migrated DB connection is available (Docker was reachable). */
export function dbAvailable(): boolean {
	return db != null;
}

/**
 * Return the migrated DB connection. Throws when unavailable — callers must guard with
 * {@link dbAvailable} and skip the test body rather than calling this blindly.
 */
export function getDb(): DrizzleDb {
	if (!db) throw new Error("DB connection not available — guard with dbAvailable()");
	return db;
}

/**
 * Insert a parent list row so broadcast FK inserts succeed, returning its id.
 * Broadcasts reference `emito_lists`; this mints a minimal valid parent.
 */
export async function seedList(slug: string): Promise<string> {
	const database = getDb();
	const { emito_lists } = await import("../../src/schema/lists");
	const [row] = await database
		.insert(emito_lists)
		.values({ name: `List ${slug}`, slug })
		.returning({ id: emito_lists.id });
	if (!row) throw new Error(`Failed to seed list "${slug}"`);
	return row.id;
}

/** Insert a parent alert row so alert-history FK inserts succeed, returning its id. */
export async function seedAlert(name: string): Promise<string> {
	const database = getDb();
	const { emito_alerts } = await import("../../src/schema/alerts");
	const [row] = await database
		.insert(emito_alerts)
		.values({
			name,
			metric: "bounce_rate",
			condition: { operator: "gt", threshold: 0.1 },
			severity: "warning",
			notify: { channels: ["email"] },
		})
		.returning({ id: emito_alerts.id });
	if (!row) throw new Error(`Failed to seed alert "${name}"`);
	return row.id;
}

/** Sleep ~2ms so DB-default `createdAt`/`triggeredAt` timestamps strictly increase. */
export function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 2));
}
