import { errorResponse } from "../response.js";
import type { createRouter } from "../router.js";

const STUB_ROUTES: ReadonlyArray<{
	method: string;
	path: string;
	auth: "admin" | "subscriber" | "public";
}> = [];

export function registerStubEndpoints(router: ReturnType<typeof createRouter>): void {
	for (const stub of STUB_ROUTES) {
		router.add({
			method: stub.method,
			pathPattern: stub.path,
			auth: stub.auth,
			async handler() {
				return errorResponse({
					code: "NOT_IMPLEMENTED",
					message: `${stub.method} ${stub.path} is not yet implemented`,
					statusCode: 501,
				});
			},
		});
	}
}
