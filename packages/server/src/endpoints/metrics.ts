import type { createRouter } from "../router.js";

export function registerMetricsEndpoint(
	router: ReturnType<typeof createRouter>,
	metricsRenderer?: () => Promise<string>,
): void {
	router.add({
		method: "GET",
		pathPattern: "/metrics",
		auth: "public",
		// Scrape target — a version bump must not force a Prometheus config change.
		unversioned: true,
		async handler() {
			const contentType = "text/plain; version=0.0.4; charset=utf-8";
			if (!metricsRenderer) {
				return new Response("# No metrics renderer configured\n", {
					status: 200,
					headers: { "Content-Type": contentType },
				});
			}
			try {
				const text = await metricsRenderer();
				return new Response(text, {
					status: 200,
					headers: { "Content-Type": contentType },
				});
			} catch {
				return new Response("# metrics rendering failed\n", {
					status: 500,
					headers: { "Content-Type": contentType },
				});
			}
		},
	});
}
