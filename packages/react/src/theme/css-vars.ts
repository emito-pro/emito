import type { EmitoAppearance } from "./types.js";

/**
 * Converts a camelCase key to kebab-case with `--emito-` prefix.
 * e.g. "colorPrimary" → "--emito-color-primary"
 */
function toCustomProperty(key: string): string {
	const kebab = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
	return `--emito-${kebab}`;
}

/**
 * Maps an EmitoAppearance object to a flat record of CSS custom properties.
 * Returns an empty object when no variables are provided.
 *
 * @example
 * appearanceToVars({ variables: { colorPrimary: '#6366f1' } })
 * // → { '--emito-color-primary': '#6366f1' }
 */
export function appearanceToVars(appearance: EmitoAppearance): Record<string, string> {
	const result: Record<string, string> = {};
	const vars = appearance.variables;
	if (!vars) return result;

	for (const [key, value] of Object.entries(vars)) {
		if (value !== undefined) {
			result[toCustomProperty(key)] = value;
		}
	}

	return result;
}
