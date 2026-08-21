import type { Emito } from "@emito/core";
import { jsonResponse } from "../response.js";
import type { createRouter } from "../router.js";

export function registerHealthEndpoint(
	router: ReturnType<typeof createRouter>,
	emito: Emito,
): void {
	router.add({
		method: "GET",
		pathPattern: "/health",
		auth: "public",
		// Operational probe — kept off the version segment so liveness checks
		// survive an API version bump untouched.
		unversioned: true,
		async handler() {
			const result = await emito.healthCheck();
			const status = result.healthy ? 200 : 503;
			return jsonResponse(result, status);
		},
	});
}
