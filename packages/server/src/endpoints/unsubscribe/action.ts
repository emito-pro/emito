import type { PreferenceRepository } from "@emito/core";
import { html, htmlPage, htmlResponse } from "../../html/index.js";
import type { createRouter } from "../../router.js";
import { renderExpiredPage } from "./expired.js";
import { validateToken } from "./token.js";

export interface UnsubscribeActionDeps {
	preferenceRepository: PreferenceRepository;
	unsubscribeSecret: string;
}

export function registerUnsubscribeActionEndpoint(
	router: ReturnType<typeof createRouter>,
	deps: UnsubscribeActionDeps,
): void {
	router.add({
		method: "POST",
		pathPattern: "/unsubscribe",
		auth: "public",
		// Submit target of the unversioned unsubscribe page — the two must stay together.
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

			// Parse form-encoded body from rawBody
			const rawBody = ctx.rawBody ?? "";
			const formData = new URLSearchParams(rawBody);

			// RFC 8058 one-click unsubscribe
			if (formData.get("List-Unsubscribe") === "One-Click") {
				await processOneClickUnsubscribe(payload.sub, payload, deps);
				return new Response(null, { status: 200 });
			}

			// Full form submission from preference page
			if (formData.get("unsubscribe_all") === "true") {
				await processUnsubscribeAll(payload.sub, deps);
				return htmlResponse(renderConfirmationPage("unsubscribed from all"));
			}

			// Save individual preferences from form checkboxes
			await processPreferenceUpdate(payload.sub, formData, deps);
			return htmlResponse(renderConfirmationPage("updated"));
		},
	});
}

async function processOneClickUnsubscribe(
	subscriberId: string,
	payload: { list?: string; topic?: string; cat?: string },
	deps: UnsubscribeActionDeps,
): Promise<void> {
	// If token scopes to a specific topic, disable all channels for that topic
	if (payload.topic) {
		const prefs = await deps.preferenceRepository.findBySubscriber(subscriberId, {
			workspaceId: null,
			topicKey: payload.topic,
		});
		for (const p of prefs) {
			await deps.preferenceRepository.upsert({
				subscriberId,
				workspaceId: null,
				topicKey: p.topicKey,
				channel: p.channel,
				enabled: false,
			});
		}
		// If no existing prefs, create disabled entries for the common channels
		if (prefs.length === 0) {
			await deps.preferenceRepository.upsert({
				subscriberId,
				workspaceId: null,
				topicKey: payload.topic,
				channel: "email",
				enabled: false,
			});
		}
		return;
	}

	// If no specific scope, disable all non-essential preferences
	await processUnsubscribeAll(subscriberId, deps);
}

async function processUnsubscribeAll(
	subscriberId: string,
	deps: UnsubscribeActionDeps,
): Promise<void> {
	const allPrefs = await deps.preferenceRepository.findBySubscriber(subscriberId, {
		workspaceId: null,
	});
	for (const p of allPrefs) {
		await deps.preferenceRepository.upsert({
			subscriberId,
			workspaceId: null,
			topicKey: p.topicKey,
			channel: p.channel,
			enabled: false,
		});
	}
}

async function processPreferenceUpdate(
	subscriberId: string,
	formData: URLSearchParams,
	deps: UnsubscribeActionDeps,
): Promise<void> {
	// Load current preferences to know what exists
	const currentPrefs = await deps.preferenceRepository.findBySubscriber(subscriberId, {
		workspaceId: null,
	});

	// Build a set of enabled keys from form data (checked checkboxes)
	const enabledKeys = new Set<string>();
	for (const [key, value] of formData.entries()) {
		if (key.startsWith("pref_") && value === "on") {
			enabledKeys.add(key);
		}
	}

	// Update each known preference based on whether its checkbox was checked
	for (const p of currentPrefs) {
		const formKey = `pref_${p.topicKey}_${p.channel}`;
		const enabled = enabledKeys.has(formKey);
		await deps.preferenceRepository.upsert({
			subscriberId,
			workspaceId: null,
			topicKey: p.topicKey,
			channel: p.channel,
			enabled,
		});
	}
}

function renderConfirmationPage(action: string): string {
	const body = html`<h1 class="success">Preferences ${action}</h1>
<p>Your email preferences have been ${action} successfully.</p>
<p>Changes take effect immediately.</p>
<div class="footer">
<p>Powered by Emito</p>
</div>`;
	return htmlPage("Preferences updated", body);
}
