import type {
	CreateDeadLetterData,
	CursorResult,
	DeadLetterFilter,
	DeadLetterRecord,
} from "./types";

export interface DeadLetterRepository {
	create(data: CreateDeadLetterData): Promise<DeadLetterRecord>;
	list(filter?: DeadLetterFilter): Promise<CursorResult<DeadLetterRecord>>;
	findById(id: string): Promise<DeadLetterRecord | null>;
	resolve(id: string, resolution: string): Promise<void>;
	unresolve(id: string): Promise<void>;
	/**
	 * Permanently delete every resolved dead letter (the danger-zone
	 * "purge DLQ" operation). Unresolved entries are left untouched.
	 *
	 * @returns The number of resolved rows removed.
	 */
	purgeResolved(): Promise<number>;
	/**
	 * Fetch every dead-letter record (resolved and unresolved alike) newest-first
	 * by `exhaustedAt`, for the admin DLQ list.
	 *
	 * The admin list (`GET /admin/dead-letters`) filters on dimensions the
	 * storage layer cannot express in SQL — most notably the auto-classified
	 * `rootCause`, which is derived from the attempt chain's status codes, not a
	 * stored column. The endpoint therefore loads the (operational-scale) DLQ,
	 * projects each row to the wire shape, then filters and cursor-paginates in
	 * memory.
	 * Implementations apply an internal safety cap on the number of rows returned.
	 *
	 * @returns All dead-letter records, ordered newest-first.
	 */
	findAllForAdmin(): Promise<DeadLetterRecord[]>;
}
