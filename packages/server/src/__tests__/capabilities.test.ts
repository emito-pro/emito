import { describe, expect, it } from "vitest";
import { registerCapabilitiesEndpoint } from "../endpoints/capabilities.js";
import { createRouter } from "../router.js";

describe("capabilities endpoint", () => {
	it("returns configured transports", async () => {
		const router = createRouter("/emito", "v1");
		registerCapabilitiesEndpoint(router, {
			transports: ["ws", "sse", "polling"],
		});

		const match = router.match("GET", "/emito/v1/capabilities");
		expect(match).not.toBeNull();

		const request = new Request("http://localhost/emito/v1/capabilities");
		const response = await match!.route.handler(
			{ params: {}, query: {}, body: undefined } as Parameters<
				NonNullable<typeof match>["route"]["handler"]
			>[0],
			request,
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: { transports: string[] } };
		expect(body.data.transports).toEqual(["ws", "sse", "polling"]);
	});

	it("returns only registered transports", async () => {
		const router = createRouter("/emito", "v1");
		registerCapabilitiesEndpoint(router, {
			transports: ["sse", "polling"],
		});

		const match = router.match("GET", "/emito/v1/capabilities");
		const request = new Request("http://localhost/emito/v1/capabilities");
		const response = await match!.route.handler(
			{ params: {}, query: {}, body: undefined } as Parameters<
				NonNullable<typeof match>["route"]["handler"]
			>[0],
			request,
		);

		const body = (await response.json()) as { data: { transports: string[] } };
		expect(body.data.transports).toEqual(["sse", "polling"]);
	});

	it("uses public auth (no authentication required)", () => {
		const router = createRouter("/emito", "v1");
		registerCapabilitiesEndpoint(router, {
			transports: ["ws"],
		});

		const match = router.match("GET", "/emito/v1/capabilities");
		expect(match!.route.auth).toBe("public");
	});
});
