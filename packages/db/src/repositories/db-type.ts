import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * The Drizzle database client type used across all repository implementations.
 * Uses `any` for the generic parameter because Drizzle's PgDatabase generic
 * is complex and varies by driver. This is acceptable at the repository boundary.
 */
// biome-ignore lint/suspicious/noExplicitAny: Drizzle's PgDatabase generic varies by driver
export type DrizzleDb = PgDatabase<any>;
