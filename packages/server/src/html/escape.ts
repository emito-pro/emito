const ESCAPE_MAP: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#x27;",
};

const ESCAPE_RE = /[&<>"']/g;

/**
 * Escape a string for safe inclusion in HTML content and attribute values.
 * Covers all 5 dangerous characters per OWASP XSS prevention rules.
 */
export function htmlEscape(str: string): string {
	return str.replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch] ?? ch);
}
