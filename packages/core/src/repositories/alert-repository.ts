import type { AlertCreate, AlertFilters, AlertPatch, AlertRecord, ApiPage } from "./admin-types";

/**
 * Alert-rule definitions evaluated against current metrics.
 *
 * {@link update} supports optimistic concurrency via `expectedVersion`: when supplied and
 * the stored `version` differs, the update is rejected with `RESOURCE_CONFLICT`. Every
 * successful update bumps `version`. {@link markTriggered} records a firing without bumping
 * the optimistic-concurrency version (it is an out-of-band evaluation event, not an edit).
 */
export interface AlertRepository {
	/**
	 * Page over alert rules newest-first, applying optional filters.
	 *
	 * @throws EmitoError CURSOR_INVALID when the cursor cannot be decoded.
	 */
	list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AlertFilters;
	}): Promise<ApiPage<AlertRecord>>;

	/** Fetch a single alert rule by id, or null when absent. */
	findById(id: string): Promise<AlertRecord | null>;

	/** Create a new alert rule. `enabled` defaults to true; `version` starts at 1. */
	create(input: AlertCreate): Promise<AlertRecord>;

	/**
	 * Patch an alert rule. Undefined fields are left untouched.
	 *
	 * @param opts.expectedVersion - When set, the update is rejected unless it matches the
	 *   stored version (optimistic concurrency).
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 * @throws EmitoError RESOURCE_CONFLICT when `expectedVersion` does not match.
	 */
	update(id: string, patch: AlertPatch, opts?: { expectedVersion?: number }): Promise<AlertRecord>;

	/**
	 * Delete an alert rule (and, via FK cascade, its history).
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 */
	delete(id: string): Promise<void>;

	/**
	 * Record that the rule fired at `at`. Does not bump the optimistic-concurrency version.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 */
	markTriggered(id: string, at: Date): Promise<void>;
}
