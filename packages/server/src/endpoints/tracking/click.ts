import { EMITO_ERROR_CODE } from "@emito/types";
import { errorResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import type { TrackingEndpointDeps } from "./index.js";

/**
 * Validate that a URL is safe for redirect: must be absolute http or https.
 * Rejects javascript:, data:, and other dangerous schemes.
 */
function isValidRedirectUrl(raw: string): boolean {
	try {
		const url = new URL(raw);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export function registerClickRedirectEndpoint(
	router: ReturnType<typeof createRouter>,
	deps: TrackingEndpointDeps,
): void {
	router.add({
		method: "GET",
		pathPattern: "/track/click/:id/:idx",
		auth: "public",
		// Baked into already-delivered email — see the note on the open pixel.
		unversioned: true,
		async handler(ctx) {
			// Read target URL from query param
			const toParam = ctx.query.to;
			const targetUrl = Array.isArray(toParam) ? toParam[0] : toParam;

			if (!targetUrl || !isValidRedirectUrl(targetUrl)) {
				return errorResponse({
					code: "INVALID_REDIRECT_URL",
					message: "Missing or invalid target URL",
					statusCode: 400,
				});
			}

			const notificationId = ctx.params.id;
			if (notificationId) {
				try {
					const notification = await deps.notificationRepository.findById(notificationId);
					if (notification) {
						const subscriber = await deps.subscriberRepository.findById(notification.subscriberId);
						const trackingEnabled = subscriber?.metadata?.trackingEnabled !== false;

						if (trackingEnabled) {
							await deps.transitionStatus(notification.id, "clicked", {
								from: notification.status,
							});
						}
					}
				} catch {
					// Don't block the redirect on tracking errors
					deps.logger.warn(
						{
							notificationId,
							errorCode: EMITO_ERROR_CODE.DELIVERY_FAILED,
						},
						"tracking click failed",
					);
				}
			}

			// Always redirect regardless of tracking status
			return new Response(null, {
				status: 302,
				headers: { Location: targetUrl },
			});
		},
	});
}
