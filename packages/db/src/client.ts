import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Create a configured Drizzle client for PostgreSQL.
 * Uses `casing: 'snake_case'` for automatic camelCase→snake_case column mapping.
 */
export function createDrizzleClient(connectionString: string) {
	const sql = postgres(connectionString);
	return drizzle(sql, { casing: "snake_case" });
}
