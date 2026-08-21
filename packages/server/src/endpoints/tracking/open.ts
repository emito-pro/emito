import { EMITO_ERROR_CODE } from "@emito/types";
import type { DeliveryStatus } from "@emito/types";
import type { createRouter } from "../../router.js";
import type { TrackingEndpointDeps } from "./index.js";

/**
 * 1x1 transparent GIF pixel (43 bytes).
 * Hardcoded to avoid filesystem reads on every tracking request.
 */
const TRACKING_PIXEL = Buffer.from(
	"R0lGODlhAQABAIAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
	"base64",
);

/**
 * Basic Apple Mail Privacy Protection heuristic.
 * Day 1 implementation — checks for common Apple proxy User-Agent patterns.
 * Sophisticated detection is a backlog item.
 */
function isAppleMPP(userAgent: string | null): boolean {
	if (!userAgent) return false;
	const ua = userAgent.toLowerCase();
	return ua.includes("applemailproxy");
}

export function registerOpenPixelEndpoint(
	router: ReturnType<typeof createRouter>,
	deps: TrackingEndpointDeps,
): void {
	router.add({
		method: "GET",
		pathPattern: "/track/open/:id",
		auth: "public",
		// Baked into already-delivered email — these URLs sit in inboxes for years,
		// so versioning them would pin every past version open indefinitely.
		unversioned: true,
		async handler(ctx, request) {
			const pixelResponse = () =>
				new Response(TRACKING_PIXEL, {
					status: 200,
					headers: {
						"Content-Type": "image/gif",
						"Cache-Control": "no-store",
						"Content-Length": String(TRACKING_PIXEL.length),
					},
				});

			const notificationId = ctx.params.id;
			if (!notificationId) return pixelResponse();

			try {
				const notification = await deps.notificationRepository.findById(notificationId);
				if (!notification) return pixelResponse();

				const subscriber = await deps.subscriberRepository.findById(notification.subscriberId);
				const trackingEnabled = subscriber?.metadata?.trackingEnabled !== false;

				if (trackingEnabled) {
					const userAgent = request.headers.get("user-agent");
					const targetStatus: DeliveryStatus = isAppleMPP(userAgent) ? "machine_opened" : "opened";

					await deps.transitionStatus(notification.id, targetStatus, {
						from: notification.status,
					});
				}
			} catch {
				// Always return GIF regardless of errors — don't leak information
				deps.logger.warn(
					{
						notificationId,
						errorCode: EMITO_ERROR_CODE.DELIVERY_FAILED,
					},
					"tracking open failed",
				);
			}

			return pixelResponse();
		},
	});
}
