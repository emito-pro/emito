/**
 * RTL language detection utility.
 *
 * Checks the language prefix of a BCP 47 locale string against known RTL languages.
 */

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

/**
 * Returns true if the given locale is a right-to-left language.
 *
 * Extracts the language prefix (before the first hyphen) and checks against
 * the RTL set: Arabic (ar), Hebrew (he), Persian (fa), Urdu (ur).
 */
export function isRtl(locale: string): boolean {
	const lang = locale.split("-")[0]?.toLowerCase() ?? "";
	return RTL_LANGUAGES.has(lang);
}
