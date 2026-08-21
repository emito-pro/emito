import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeEach, inject } from "vitest";

const connectionUri = inject("DB_URI");

export let db: PostgresJsDatabase | undefined;

if (connectionUri) {
	const queryClient = postgres(connectionUri);
	db = drizzle(queryClient, { casing: "snake_case" });
}

beforeEach(async () => {
	if (!db) return;

	// Truncate all emito_ tables between tests for isolation
	const tables = await db.execute<{ tablename: string }>(
		sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'emito_%'`,
	);

	if (tables.length > 0) {
		const tableList = tables.map((t) => `"${t.tablename.replace(/"/g, "")}"`).join(", ");
		await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} CASCADE`));
	}
});
