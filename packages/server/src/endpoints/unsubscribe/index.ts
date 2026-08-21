import type { PreferenceRepository, SubscriberRepository } from "@emito/core";
import type { createRouter } from "../../router.js";
import { registerUnsubscribeActionEndpoint } from "./action.js";
import { registerUnsubscribePageEndpoint } from "./page.js";

export interface UnsubscribeEndpointDeps {
	subscriberRepository: SubscriberRepository;
	preferenceRepository: PreferenceRepository;
	unsubscribeSecret: string;
}

export function registerUnsubscribeEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: UnsubscribeEndpointDeps,
): void {
	registerUnsubscribePageEndpoint(router, deps);
	registerUnsubscribeActionEndpoint(router, deps);
}

export { validateToken } from "./token.js";
export type { TokenPayload } from "./token.js";
