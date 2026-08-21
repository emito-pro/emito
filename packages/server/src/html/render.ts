import { htmlEscape } from "./escape.js";

const SECURITY_HEADERS: Record<string, string> = {
	"Content-Type": "text/html; charset=utf-8",
	"Content-Security-Policy":
		"default-src 'none'; style-src 'unsafe-inline'; img-src *; form-action 'self'",
	"X-Content-Type-Options": "nosniff",
};

/**
 * Branded type for HTML strings that have been safely constructed.
 * Only the `html` tagged template and `htmlPage` produce this type.
 * Raw strings cannot be passed where SafeHtml is required — this prevents
 * accidental XSS by ensuring all user-derived content is auto-escaped.
 */
export type SafeHtml = string & { readonly __brand: unique symbol };

/**
 * Tagged template literal that auto-escapes all interpolated values.
 * Returns a SafeHtml branded string — the only safe way to construct HTML
 * containing user data.
 *
 * Usage: html`<p>${userInput}</p>` — userInput is escaped, static parts are not.
 *
 * To compose SafeHtml fragments, interpolate them directly — they pass through
 * as strings (already escaped). Never use raw string concatenation with user data.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
	let result = "";
	for (let i = 0; i < strings.length; i++) {
		result += strings[i];
		if (i < values.length) {
			result += htmlEscape(String(values[i]));
		}
	}
	return result as SafeHtml;
}

/**
 * Join pre-escaped SafeHtml fragments into a single SafeHtml string.
 * The separator is not escaped (should be a safe literal like "\n").
 */
export function joinHtml(fragments: SafeHtml[], separator = "\n"): SafeHtml {
	return fragments.join(separator) as SafeHtml;
}

/**
 * Map items to SafeHtml fragments and join them.
 * Convenience wrapper: mapHtml(items, fn) === joinHtml(items.map(fn)).
 */
export function mapHtml<T>(items: T[], fn: (item: T) => SafeHtml, separator = "\n"): SafeHtml {
	return items.map(fn).join(separator) as SafeHtml;
}

/**
 * Mark a string as safe HTML without escaping. Escape hatch for edge cases
 * where SafeHtml fragments are composed outside of joinHtml/mapHtml.
 * Grep for this in code reviews — every usage needs justification.
 * Never use with user-derived data.
 */
export function unsafeRaw(content: string): SafeHtml {
	return content as SafeHtml;
}

/**
 * Wrap body content in a full HTML document shell with security headers baked in.
 * Accepts only SafeHtml for bodyContent — callers must use the `html` tagged template
 * to construct the body, ensuring all interpolated values are escaped.
 */
export function htmlPage(title: string, bodyContent: SafeHtml): string {
	const escapedTitle = htmlEscape(title);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src *; form-action 'self'">
<title>${escapedTitle}</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #111827; line-height: 1.6; }
h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
.subtitle { color: #6b7280; margin-bottom: 2rem; }
.section { margin-bottom: 2rem; }
.section-title { font-weight: 600; margin-bottom: 0.75rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
label { display: flex; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.75rem; cursor: pointer; }
label.disabled { cursor: default; color: #9ca3af; }
input[type="checkbox"] { margin-top: 0.25rem; }
.description { font-size: 0.875rem; color: #6b7280; }
.btn { display: inline-block; padding: 0.625rem 1.25rem; background: #111827; color: #fff; border: none; border-radius: 0.375rem; font-size: 1rem; cursor: pointer; }
.btn:hover { background: #374151; }
.link { color: #6b7280; font-size: 0.875rem; text-decoration: underline; }
.footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 0.75rem; }
.success { color: #16a34a; }
.expired { color: #dc2626; }
</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

/**
 * Return an HTML Response with the standard security headers.
 */
export function htmlResponse(body: string, status = 200): Response {
	return new Response(body, { status, headers: SECURITY_HEADERS });
}
