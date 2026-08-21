import type {
	ApiPage,
	AuditLogEntry,
	AuditLogFilters,
	AuditLogRecord,
	RepositoryTx,
} from "./admin-types";

/**
 * Append-only audit log of every mutating admin action.
 *
 * Mutating endpoints call {@link create} inside the same transaction as their mutation,
 * passing the transaction handle so an audit-write failure rolls the whole change back.
 * The log is immutable — there is no update or delete. {@link list} pages newest-first
 * over `createdAt` and supports actor/resource/severity/action/time-range filters.
 */
export interface AuditLogRepository {
	/**
	 * Append one row to the audit log.
	 *
	 * @param entry - The action to record. `resourceId` may be null for bulk operations.
	 * @param tx - Optional transaction handle so the write participates in the caller's
	 *   transaction; when omitted the write runs autonomously.
	 * @returns The persisted record with its generated id and `createdAt`.
	 */
	create(entry: AuditLogEntry, tx?: RepositoryTx): Promise<AuditLogRecord>;

	/**
	 * Page over the audit log newest-first, applying optional filters.
	 *
	 * @param opts - Cursor, page limit, and optional filter facets.
	 * @returns A cursor page including the total filtered count.
	 * @throws EmitoError CURSOR_INVALID when the cursor cannot be decoded.
	 */
	list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AuditLogFilters;
	}): Promise<ApiPage<AuditLogRecord>>;

	/** Fetch a single audit-log row by id, or null when it does not exist. */
	findById(id: string): Promise<AuditLogRecord | null>;
}
