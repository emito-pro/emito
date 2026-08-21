import type { PreferenceRepository, SubscriberRepository } from "@emito/core";
import type { SafeHtml } from "../../html/index.js";
import { html, htmlPage, htmlResponse, joinHtml, mapHtml } from "../../html/index.js";
import type { createRouter } from "../../router.js";
import { renderExpiredPage } from "./expired.js";
import { validateToken } from "./token.js";

export interface UnsubscribePageDeps {
	subscriberRepository: SubscriberRepository;
	preferenceRepository: PreferenceRepository;
	unsubscribeSecret: string;
}

export function registerUnsubscribePageEndpoint(
	router: ReturnType<typeof createRouter>,
	deps: UnsubscribePageDeps,
): void {
	router.add({
		method: "GET",
		pathPattern: "/unsubscribe",
		auth: "public",
		// Linked from delivered email, and an HTML page rather than a wire
		// contract — it must keep resolving long after a version bump.
		unversioned: true,
		async handler(ctx) {
			const rawToken = ctx.query.token;
			const token = typeof rawToken === "string" ? rawToken : undefined;

			if (!token) {
				return htmlResponse(renderExpiredPage());
			}

			const payload = validateToken(token, deps.unsubscribeSecret, "unsubscribe");
			if (!payload) {
				return htmlResponse(renderExpiredPage());
			}

			const subscriber = await deps.subscriberRepository.findById(payload.sub);
			if (!subscriber) {
				return htmlResponse(renderExpiredPage());
			}

			const preferences = await deps.preferenceRepository.findBySubscriber(payload.sub, {
				workspaceId: null,
			});

			const email = subscriber.email ?? "";
			const pageHtml = renderPreferencePage(email, preferences, token);
			return htmlResponse(pageHtml);
		},
	});
}

interface PreferenceItem {
	topicKey: string;
	channel: string;
	enabled: boolean;
}

function renderPreferencePage(email: string, preferences: PreferenceItem[], token: string): string {
	const encodedToken = encodeURIComponent(token);
	const preferencesHtml: SafeHtml =
		preferences.length > 0
			? mapHtml(
					preferences,
					(p) => html`<label>
	<input type="checkbox" name="pref_${p.topicKey}_${p.channel}" value="on"${p.enabled ? " checked" : ""}>
	<span><strong>${p.topicKey}</strong> (${p.channel})</span>
</label>`,
				)
			: html`<p class="description">No preferences configured yet.</p>`;

	const header = html`<h1>Manage your email preferences</h1>
<p class="subtitle">Choose what you receive from us.</p>`;

	const formOpen = html`<form method="POST" action="/emito/unsubscribe?token=${encodedToken}">
<div class="section">
<div class="section-title">Your preferences</div>`;

	const formClose = html`</div>
<button type="submit" class="btn">Save Preferences</button>
</form>`;

	const unsubAll = html`<div style="margin-top: 1rem;">
<form method="POST" action="/emito/unsubscribe?token=${encodedToken}">
<input type="hidden" name="unsubscribe_all" value="true">
<button type="submit" class="link" style="background:none;border:none;padding:0;cursor:pointer;">Unsubscribe from all non-essential emails</button>
</form>
</div>`;

	const footer = html`<div class="footer">
<p>Your email: ${email}</p>
<p>Powered by Emito</p>
</div>`;

	const body = joinHtml([header, formOpen, preferencesHtml, formClose, unsubAll, footer]);

	return htmlPage("Manage your email preferences", body);
}
