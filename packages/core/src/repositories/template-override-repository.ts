import type {
	TemplateGalleryCell,
	TemplateOverrideCreate,
	TemplateOverrideRecord,
} from "./admin-types";

/**
 * Custom template source overriding the built-in defaults per (event, channel, locale).
 *
 * Overrides are append-only versions: {@link create} auto-bumps `version` to `max+1` for the
 * triple so history is retained. {@link findActive} resolves the highest-version override for
 * a triple. {@link listGallery} returns the matrix of (event, channel, locale) cells with the
 * editorial status the template gallery renders. {@link history} returns recent versions newest-first.
 */
export interface TemplateOverrideRepository {
	/**
	 * Return one cell per distinct (event, channel, locale) that has a custom override,
	 * tagged `present-custom` with the latest version's `updatedAt`.
	 *
	 * The default/fallback/missing cells are computed by the endpoint layer against the
	 * registry of built-in templates; this repository only knows about custom overrides.
	 */
	listGallery(): Promise<readonly TemplateGalleryCell[]>;

	/** Resolve the highest-version override for a triple, or null when none exists. */
	findActive(
		eventKey: string,
		channel: string,
		locale: string,
	): Promise<TemplateOverrideRecord | null>;

	/**
	 * Append a new override version. `version` is auto-bumped to `max(existing)+1` for the
	 * (event, channel, locale) triple — callers never supply it.
	 */
	create(input: TemplateOverrideCreate): Promise<TemplateOverrideRecord>;

	/** Return the most recent `limit` versions for a triple, newest-version-first. */
	history(
		eventKey: string,
		channel: string,
		locale: string,
		limit: number,
	): Promise<readonly TemplateOverrideRecord[]>;
}
