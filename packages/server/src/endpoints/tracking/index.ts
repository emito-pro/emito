import type { NotificationRepository, SubscriberRepository } from "@emito/core";
import type { DeliveryStatus, Logger } from "@emito/types";
import type { createRouter } from "../../router.js";
import { registerClickRedirectEndpoint } from "./click.js";
import { registerOpenPixelEndpoint } from "./open.js";

export interface TrackingEndpointDeps {
	notificationRepository: NotificationRepository;
	subscriberRepository: SubscriberRepository;
	transitionStatus: (
		notificationId: string,
		status: DeliveryStatus,
		metadata?: Record<string, unknown>,
	) => Promise<void>;
	logger: Logger;
}

export function registerTrackingEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: TrackingEndpointDeps,
): void {
	registerOpenPixelEndpoint(router, deps);
	registerClickRedirectEndpoint(router, deps);
}
