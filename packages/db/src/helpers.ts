import type { Column, SQL } from "drizzle-orm";
import { isNull } from "drizzle-orm";
import { timestamp } from "drizzle-orm/pg-core";
import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * Reusable timestamp columns for all mutable Emito tables.
 * Returns `{ createdAt, updatedAt }` column definitions with TIMESTAMPTZ and defaultNow().
 */
export const timestamps = {
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/**
 * Encode a cursor value as an opaque base64 token.
 */
export function encodeCursor(value: string): string {
	return Buffer.from(value, "utf-8").toString("base64url");
}

/**
 * Decode an opaque base64 cursor token back to its original value.
 */
export function decodeCursor(token: string): string {
	return Buffer.from(token, "base64url").toString("utf-8");
}

export interface CursorPaginateOptions {
	cursor?: string | undefined;
	limit: number;
	direction?: "asc" | "desc";
}

export interface CursorPaginateResult<T> {
	data: T[];
	nextCursor: string | null;
}

/**
 * Apply cursor-based pagination to a set of results.
 *
 * Takes an already-ordered array of rows and a column accessor to extract the cursor value.
 * The caller is responsible for building the query with the correct WHERE and ORDER BY clauses.
 *
 * @param rows - Query result rows, already ordered
 * @param limit - Maximum number of rows to return
 * @param getCursorValue - Function to extract the cursor value from a row
 * @returns Paginated result with opaque nextCursor token
 */
export function cursorPaginate<T>(
	rows: T[],
	limit: number,
	getCursorValue: (row: T) => string,
): CursorPaginateResult<T> {
	const hasMore = rows.length > limit;
	const data = hasMore ? rows.slice(0, limit) : rows;
	const lastRow = data[data.length - 1];
	const nextCursor = hasMore && lastRow != null ? encodeCursor(getCursorValue(lastRow)) : null;

	return { data, nextCursor };
}

/**
 * Build a WHERE condition that filters out soft-deleted records.
 * Adds `WHERE column IS NULL` to exclude erased/deleted records.
 */
export function withSoftDelete(column: Column): SQL {
	return isNull(column);
}

/**
 * Execute a function within a database transaction.
 * Thin wrapper around Drizzle's `db.transaction()`.
 */
export async function withTransaction<TResult>(
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle's PgDatabase generic is complex; any is acceptable here for the transaction wrapper
	db: PgDatabase<any>,
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle's PgDatabase generic requires any for the transaction callback type extraction
	fn: (tx: Parameters<Parameters<PgDatabase<any>["transaction"]>[0]>[0]) => Promise<TResult>,
): Promise<TResult> {
	return db.transaction(fn);
}
