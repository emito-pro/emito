import type {
	AdminBroadcastCreate,
	AdminBroadcastFilters,
	AdminBroadcastRecord,
	ApiPage,
	BroadcastCounters,
} from "./admin-types";

/**
 * Send-records of executed broadcasts (distinct from scheduling in scheduled-sends).
 *
 * {@link incrementCounters} applies signed deltas to the per-outcome funnel counters
 * (`sentCount`, `deliveredCount`, …) atomically as deliveries complete; counters are
 * clamped at 0 so a negative delta never underflows. {@link cancel} transitions a
 * non-terminal broadcast to `cancelled`.
 *
 * Named `*Admin*` to avoid colliding with the in-flight `BroadcastRecord` used by the
 * core broadcast *service* — this repository persists historical send-records, not the
 * live job state.
 */
export interface BroadcastRepository {
	/**
	 * Page over broadcast send-records newest-first, applying optional filters.
	 *
	 * @throws EmitoError CURSOR_INVALID when the cursor cannot be decoded.
	 */
	list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AdminBroadcastFilters;
	}): Promise<ApiPage<AdminBroadcastRecord>>;

	/** Fetch a single broadcast send-record by id, or null when absent. */
	findById(id: string): Promise<AdminBroadcastRecord | null>;

	/** Create a broadcast send-record. Counters default to 0; `status` to `scheduled`. */
	create(input: AdminBroadcastCreate): Promise<AdminBroadcastRecord>;

	/**
	 * Cancel a broadcast, transitioning it to `cancelled`.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 * @throws EmitoError RESOURCE_CONFLICT when the broadcast is already terminal (sent/cancelled).
	 */
	cancel(id: string, userId: string): Promise<AdminBroadcastRecord>;

	/**
	 * Apply signed deltas to the funnel counters atomically. Counters clamp at 0.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 */
	incrementCounters(id: string, deltas: Partial<BroadcastCounters>): Promise<void>;
}
