import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ApiPage } from "../admin-types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

/**
 * Normalize a page limit to 1..1000 (default 50), matching the Drizzle `normalizeLimit`.
 */
export function normalizeLimit(limit?: number): number {
	return Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT));
}

/**
 * Encode a cursor value (an ISO date string) as an opaque base64url token.
 * Mirrors `@emito/db`'s `encodeCursor` so cursors are interchangeable across impls.
 */
export function encodeAdminCursor(value: string): string {
	return Buffer.from(value, "utf-8").toString("base64url");
}

/**
 * Decode an opaque cursor token back to a Date, or undefined when no cursor was supplied.
 *
 * @throws EmitoError CURSOR_INVALID when the token does not decode to a valid date.
 */
export function decodeAdminCursorDate(cursor?: string | null): Date | undefined {
	if (cursor === undefined || cursor === null || cursor === "") return undefined;
	const raw = Buffer.from(cursor, "base64url").toString("utf-8");
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
 * Slice an already-filtered, already-sorted (newest-first) array into an {@link ApiPage}.
 *
 * `total` is the full **filtered** length and is independent of the cursor position — an
 * admin pagination footer shows the absolute "x–y of total" range regardless of which page
 * is loaded. The cursor then narrows the window with a strictly-less-than comparison on the
 * sort timestamp, matching the Drizzle `lt(column, cursorDate)` boundary so both impls agree.
 *
 * @param sorted - The full filtered list (pre-cursor), ordered newest-first by `getSortDate`.
 * @param getSortDate - Extracts the timestamp the cursor compares against.
 * @param cursor - Opaque cursor token from the previous page, or null/undefined for page 1.
 * @param limit - Requested page size (normalized to 1..1000).
 * @throws EmitoError CURSOR_INVALID when the cursor cannot be decoded.
 */
export function sliceToApiPage<T>(
	sorted: readonly T[],
	getSortDate: (item: T) => Date,
	cursor: string | null | undefined,
	limit: number,
): ApiPage<T> {
	const pageSize = normalizeLimit(limit);
	const cursorDate = decodeAdminCursorDate(cursor);

	// `total` reflects the filter set only — it must not shrink as the caller pages forward.
	const total = sorted.length;

	const windowed =
		cursorDate === undefined
			? sorted
			: sorted.filter((item) => getSortDate(item).getTime() < cursorDate.getTime());

	const hasMore = windowed.length > pageSize;
	const items = windowed.slice(0, pageSize);
	const last = items[items.length - 1];

	return {
		items,
		hasMore,
		cursor: hasMore && last ? encodeAdminCursor(getSortDate(last).toISOString()) : null,
		total,
	};
}
