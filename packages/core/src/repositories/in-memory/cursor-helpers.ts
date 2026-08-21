import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { CursorResult } from "../types";

const DEFAULT_LIMIT = 50;

/**
 * Apply cursor-based pagination to an already-sorted array of items.
 * Cursor is a base64url-encoded ISO date string (matching @emito/db helpers).
 * Throws CURSOR_INVALID on corrupted cursors.
 */
export function applyInMemoryCursor<T>(
	items: T[],
	getCreatedAt: (item: T) => Date,
	cursor?: string,
	limit?: number,
): CursorResult<T> {
	const pageSize = Math.min(limit ?? DEFAULT_LIMIT, 1000);

	let filtered = items;
	if (cursor) {
		const raw = Buffer.from(cursor, "base64url").toString("utf-8");
		const cursorDate = new Date(raw);
		if (Number.isNaN(cursorDate.getTime())) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.CURSOR_INVALID,
				message: `Invalid pagination cursor: could not decode "${cursor}" to a valid date`,
				isRetryable: false,
				context: { cursor, decoded: raw },
			});
		}
		filtered = items.filter((item) => getCreatedAt(item) < cursorDate);
	}

	const hasMore = filtered.length > pageSize;
	const page = filtered.slice(0, pageSize);
	const lastItem = page[page.length - 1];

	return {
		items: page,
		hasMore,
		cursor:
			hasMore && lastItem
				? Buffer.from(getCreatedAt(lastItem).toISOString(), "utf-8").toString("base64url")
				: undefined,
	};
}
