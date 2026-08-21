import type { ApiPage, SavedViewCreate, SavedViewPatch, SavedViewRecord } from "./admin-types";

/**
 * Cross-page named filter sets persisted server-side per user.
 *
 * {@link list} is always user-scoped (a user sees only their own views) and may be further
 * narrowed by `page`. {@link create} enforces the `(createdByUserId, name, page)` uniqueness
 * constraint, throwing `RESOURCE_CONFLICT` on a duplicate name for the same page.
 */
export interface SavedViewRepository {
	/**
	 * Page over one user's saved views newest-first, optionally narrowed to a `page`.
	 *
	 * @throws EmitoError CURSOR_INVALID when the cursor cannot be decoded.
	 */
	list(opts: {
		userId: string;
		page?: string;
		cursor?: string | null;
		limit: number;
	}): Promise<ApiPage<SavedViewRecord>>;

	/** Fetch a single saved view by id, or null when absent. */
	findById(id: string): Promise<SavedViewRecord | null>;

	/**
	 * Create a saved view. `scope` defaults to `private`.
	 *
	 * @throws EmitoError RESOURCE_CONFLICT when (user, name, page) already exists.
	 */
	create(input: SavedViewCreate): Promise<SavedViewRecord>;

	/**
	 * Patch a saved view. Undefined fields are left untouched.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 */
	update(id: string, patch: SavedViewPatch): Promise<SavedViewRecord>;

	/**
	 * Delete a saved view.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 */
	delete(id: string): Promise<void>;
}
