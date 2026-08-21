import { jsonResponse } from "../response.js";
import type { createRouter } from "../router.js";

export interface CapabilitiesConfig {
	transports: string[];
}

/**
 * Register the capabilities endpoint: GET /capabilities
 * Public auth — allows clients to discover available transports before connecting.
 */
export function registerCapabilitiesEndpoint(
	router: ReturnType<typeof createRouter>,
	config: CapabilitiesConfig,
): void {
	router.add({
		method: "GET",
		pathPattern: "/capabilities",
		auth: "public",
		async handler() {
			return jsonResponse({ transports: config.transports });
		},
	});
}
