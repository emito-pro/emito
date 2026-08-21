/**
 * Lang resolution utility.
 *
 * 4-step chain:
 *   1. params.lang       (per-send override)
 *   2. subscriber.lang   (stored preference)
 *   3. config.defaultLang
 *   4. 'en'              (hardcoded fallback)
 */

export interface ResolveLangParams {
	paramsLang?: string;
	subscriberLang?: string;
	configDefaultLang?: string;
}

export function resolveLang(params: ResolveLangParams): string {
	if (params.paramsLang) return params.paramsLang;
	if (params.subscriberLang) return params.subscriberLang;
	if (params.configDefaultLang) return params.configDefaultLang;
	return "en";
}

/**
 * Resolve a template from a lang map with fallback chain.
 *
 * Resolution order:
 *   1. resolvedLang (exact match)
 *   2. 'en' (English fallback)
 *   3. First available key (generic fallback)
 *   4. undefined (no templates available)
 */
export function resolveTemplateLang<T>(
	langMap: Record<string, T>,
	resolvedLang: string,
): T | undefined {
	if (langMap[resolvedLang]) return langMap[resolvedLang];
	if (langMap.en) return langMap.en;
	const firstKey = Object.keys(langMap)[0];
	if (firstKey) return langMap[firstKey];
	return undefined;
}
