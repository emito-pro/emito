import type {
	ApiPage,
	ScheduledSendCreate,
	ScheduledSendFilters,
	ScheduledSendRecord,
} from "./admin-types";

/**
 * Future-dated send-jobs (scheduled broadcasts and per-event scheduled sends).
 *
 * {@link dueBy} is the scheduler poll: it returns `pending` jobs whose `scheduledFor` has
 * passed, oldest-first, capped at `limit`. {@link cancel} transitions a non-terminal job to
 * `cancelled`; {@link reschedule} moves a pending job to a new time/timezone.
 */
export interface ScheduledSendRepository {
	/**
	 * Page over scheduled sends newest-first, applying optional filters.
	 *
	 * @throws EmitoError CURSOR_INVALID when the cursor cannot be decoded.
	 */
	list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: ScheduledSendFilters;
	}): Promise<ApiPage<ScheduledSendRecord>>;

	/** Fetch a single scheduled send by id, or null when absent. */
	findById(id: string): Promise<ScheduledSendRecord | null>;

	/** Create a scheduled send. `status` starts at `pending`. */
	create(input: ScheduledSendCreate): Promise<ScheduledSendRecord>;

	/**
	 * Cancel a scheduled send, stamping `cancelledAt`/`cancelledByUserId`.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 * @throws EmitoError RESOURCE_CONFLICT when the job is already terminal (complete/cancelled).
	 */
	cancel(id: string, userId: string): Promise<ScheduledSendRecord>;

	/**
	 * Move a pending scheduled send to a new time/timezone.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 * @throws EmitoError RESOURCE_CONFLICT when the job is not `pending`.
	 */
	reschedule(id: string, when: Date, timezone: string): Promise<ScheduledSendRecord>;

	/** Return `pending` jobs due at or before `at`, oldest-first, capped at `limit`. */
	dueBy(at: Date, limit: number): Promise<readonly ScheduledSendRecord[]>;
}
