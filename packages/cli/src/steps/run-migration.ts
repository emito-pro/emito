import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function runEmitoMigration(
	databaseUrl: string,
	migrationsFolder: string,
): Promise<void> {
	// Single-connection client so SET search_path and migrate() share the same
	// connection. search_path is forced to "public" to avoid collision when the
	// Postgres role matches the "emito" schema name.
	const sql = postgres(databaseUrl, { max: 1, connection: { search_path: "public" } });
	const db = drizzle(sql, { casing: "snake_case" });
	try {
		await migrate(db, { migrationsFolder, migrationsSchema: "emito" });
	} finally {
		await sql.end();
	}
}
