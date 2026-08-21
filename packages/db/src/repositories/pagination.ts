import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { cursorPaginate, decodeCursor } from "../helpers";

const DEFAULT_LIMIT = 50;

/**
 * Cursor-based pagination result.
 * Structurally compatible with @emito/core's CursorResult<T>.
 */
export interface CursorResult<T> {
	items: T[];
	hasMore: boolean;
	cursor?: string;
}

/**
 * Normalize limit to a valid page size (1..1000, default 50).
 */
export function normalizeLimit(limit?: number): number {
	return Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, 1000));
}

/**
 * Decode cursor if present. Throws CURSOR_INVALID on corrupted cursors.
 */
export function decodeCursorDate(cursor?: string): Date | undefined {
	if (!cursor) return undefined;
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
 * Convert cursorPaginate result (data, nextCursor) to CursorResult (items, hasMore, cursor).
 */
export function toCursorResult<T>(
	rows: T[],
	limit: number,
	getCursorValue: (row: T) => string,
): CursorResult<T> {
	const result = cursorPaginate(rows, limit, getCursorValue);
	return {
		items: result.data,
		hasMore: result.nextCursor !== null,
		cursor: result.nextCursor ?? undefined,
	};
}
