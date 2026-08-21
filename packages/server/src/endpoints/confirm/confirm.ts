import { signHS256 } from "../../auth/hs256.js";
import { html, htmlPage, htmlResponse } from "../../html/index.js";
import type { createRouter } from "../../router.js";
import { renderExpiredPage } from "../unsubscribe/expired.js";
import { validateToken } from "../unsubscribe/token.js";

/**
 * Minimal interface for confirming list membership.
 * The full ListMemberRepository is implemented elsewhere;
 * this covers only the confirm flow.
 */
export interface ListMemberConfirm {
	confirmMembership(subscriberId: string, listId: string): Promise<{ alreadyConfirmed: boolean }>;
}

export interface ConfirmEndpointDeps {
	listMemberConfirm: ListMemberConfirm;
	unsubscribeSecret: string;
	prefix: string;
	preferencesLinkTtlSeconds?: number;
}

export function registerConfirmEndpoint(
	router: ReturnType<typeof createRouter>,
	deps: ConfirmEndpointDeps,
): void {
	router.add({
		method: "POST",
		pathPattern: "/confirm",
		auth: "public",
		// Double opt-in link from delivered email — same reasoning as /unsubscribe.
		unversioned: true,
		async handler(ctx) {
			const rawToken = ctx.query.token;
			const token = typeof rawToken === "string" ? rawToken : undefined;

			if (!token) {
				return htmlResponse(renderExpiredPage());
			}

			const payload = validateToken(token, deps.unsubscribeSecret, "confirm");
			if (!payload) {
				return htmlResponse(renderExpiredPage());
			}

			const listId = payload.list;
			if (!listId) {
				return htmlResponse(renderExpiredPage());
			}

			// Confirm membership (idempotent — already confirmed is a no-op success)
			await deps.listMemberConfirm.confirmMembership(payload.sub, listId);

			const now = Math.floor(Date.now() / 1000);
			const unsubscribeToken = signHS256(
				{
					sub: payload.sub,
					scope: "unsubscribe",
					list: listId,
					iat: now,
					exp: now + (deps.preferencesLinkTtlSeconds ?? 30 * 24 * 60 * 60),
				},
				deps.unsubscribeSecret,
			);
			const preferencesUrl = `${deps.prefix}/unsubscribe?token=${unsubscribeToken}`;

			const pageBody = html`<h1 class="success">You're subscribed!</h1>
<p>You've confirmed your subscription to <strong>${listId}</strong>.</p>
<p>You'll start receiving updates soon.</p>
<p><a href="${preferencesUrl}">Manage your preferences</a></p>`;

			return htmlResponse(htmlPage("Subscription confirmed", pageBody));
		},
	});
}
