import type {
	AlertHistoryCreate,
	AlertHistoryFilters,
	AlertHistoryRecord,
	ApiPage,
} from "./admin-types";

/**
 * Per-firing history of alert rules.
 *
 * Each row is one firing: created when a rule crosses its threshold, acknowledged by an
 * operator, then resolved when the metric recovers. {@link activeAlerts} returns the rows
 * that have fired but not yet resolved (an admin "currently firing" view reads it).
 */
export interface AlertHistoryRepository {
	/**
	 * Page over firing history newest-first, applying optional filters.
	 *
	 * @throws EmitoError CURSOR_INVALID when the cursor cannot be decoded.
	 */
	list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AlertHistoryFilters;
	}): Promise<ApiPage<AlertHistoryRecord>>;

	/** Fetch a single firing by id, or null when absent. */
	findById(id: string): Promise<AlertHistoryRecord | null>;

	/** Record a new firing. `triggeredAt` defaults to now. */
	create(entry: AlertHistoryCreate): Promise<AlertHistoryRecord>;

	/**
	 * Acknowledge a firing, stamping the operator and optional notes.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 */
	acknowledge(id: string, userId: string, notes?: string): Promise<AlertHistoryRecord>;

	/**
	 * Mark a firing resolved at `at`.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 */
	resolve(id: string, at: Date): Promise<AlertHistoryRecord>;

	/** Return all firings that have not yet been resolved, newest-first. */
	activeAlerts(): Promise<readonly AlertHistoryRecord[]>;
}
