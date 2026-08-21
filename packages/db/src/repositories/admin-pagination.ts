import type { ApiPage } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { decodeCursor, encodeCursor } from "../helpers";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

/**
 * Normalize a page limit to 1..1000 (default 50) for the admin repositories.
 * Identical to the in-memory `normalizeLimit` so both impls window the same way.
 */
export function normalizeAdminLimit(limit?: number): number {
	return Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT));
}

/**
 * Decode an opaque cursor token to a Date for a `lt(timestampColumn, cursorDate)` clause.
 *
 * Accepts `null`/`undefined`/`""` as "no cursor".
 *
 * @throws EmitoError CURSOR_INVALID when the token does not decode to a valid date.
 */
export function decodeAdminCursorDate(cursor?: string | null): Date | undefined {
	if (cursor === undefined || cursor === null || cursor === "") return undefined;
	const raw = decodeCursor(cursor);
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.CURSOR_INVALID,
			message: `Invalid pagination cursor: could not decode "${cursor}" to a valid date`,
			isRetryable: false,
			context: { cursor, decoded: raw },
		});
	}
	return date;
}

/**
 * Build an {@link ApiPage} from an over-fetched row set and a known total.
 *
 * Callers fetch `limit + 1` rows (already ordered + cursor-filtered) and run a separate
 * `COUNT(*)` under the same WHERE clause to get `total`. This collapses the over-fetched
 * extra row into `hasMore` and mints the next cursor from the last *returned* row's
 * timestamp — matching the in-memory `sliceToApiPage` boundary exactly.
 *
 * @param rows - Over-fetched rows (length up to `limit + 1`), newest-first.
 * @param limit - The normalized page size.
 * @param total - The full filtered count from the COUNT(*) query.
 * @param getCursorDate - Extracts the timestamp the next cursor encodes.
 */
export function buildAdminPage<T>(
	rows: readonly T[],
	limit: number,
	total: number,
	getCursorDate: (row: T) => Date,
): ApiPage<T> {
	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : [...rows];
	const last = items[items.length - 1];
	return {
		items,
		hasMore,
		cursor: hasMore && last ? encodeCursor(getCursorDate(last).toISOString()) : null,
		total,
	};
}
