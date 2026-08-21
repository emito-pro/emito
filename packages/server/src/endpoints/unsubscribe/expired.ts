import { html, htmlPage } from "../../html/index.js";

/**
 * Render a generic "link expired" page. No error details are exposed
 * to prevent information leakage about token validation failures.
 */
export function renderExpiredPage(): string {
	return htmlPage(
		"Link expired",
		html`<h1 class="expired">This link has expired</h1>
<p>The unsubscribe link you followed is no longer valid. This can happen if the link has expired or has already been used.</p>
<p>If you need to manage your email preferences, please use the link in a more recent email.</p>`,
	);
}
