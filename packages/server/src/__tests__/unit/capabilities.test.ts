/**
 * Unit tests for the capabilities endpoint (packages/server/src/endpoints/capabilities.ts).
 *
 * Tests validate:
 *   - GET /capabilities returns 200 with { data: { transports: string[] } }
 *   - Returns empty transports array when no transport handlers registered
 *   - Returns "websocket" when WS handler is registered
 *   - Returns "sse" when SSE handler is registered
 *   - Returns "polling" when polling handler is registered
 *   - Returns all registered transports in a stable order
 *   - Route is public — no auth required
 *   - Content-Type is application/json
 *
 * Agent rules applied: #1, #7, #10, #15, #25, #26, #28, #32
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCapabilitiesEndpoint } from "../../endpoints/capabilities.js";
import { createRouter } from "../../router.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRouter() {
	return createRouter("/emito", "v1");
}

function makeReq(path = "/emito/v1/capabilities"): Request {
	return new Request(`http://localhost${path}`);
}

// ---------------------------------------------------------------------------
// describe("registerCapabilitiesEndpoint")
// ---------------------------------------------------------------------------

describe("registerCapabilitiesEndpoint", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// --- Route registration ---

	describe("route registration", () => {
		it("should register GET /capabilities route", () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: [] });
			expect(router.match("GET", "/emito/v1/capabilities")).not.toBeNull();
		});

		it("should not match POST /capabilities", () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: [] });
			expect(router.match("POST", "/emito/v1/capabilities")).toBeNull();
		});

		it("should respect the router prefix", () => {
			const router = createRouter("/api/notify");
			registerCapabilitiesEndpoint(router, { transports: [] });
			expect(router.match("GET", "/api/notify/capabilities")).not.toBeNull();
			expect(router.match("GET", "/emito/v1/capabilities")).toBeNull();
		});
	});

	// --- Response shape ---

	describe("response shape", () => {
		it("should return 200", async () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: [] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			expect(res.status).toBe(200);
		});

		it("should return application/json Content-Type", async () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: [] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			expect(res.headers.get("content-type")).toContain("application/json");
		});

		it("should return data envelope with transports array", async () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: [] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			const body = (await res.json()) as { data: { transports: string[] } };
			expect(body.data).toBeDefined();
			expect(Array.isArray(body.data.transports)).toBe(true);
		});
	});

	// --- Transport list ---

	describe("transports array", () => {
		it("should return empty array when no transports registered", async () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: [] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			const body = (await res.json()) as { data: { transports: string[] } };
			expect(body.data.transports).toEqual([]);
		});

		it("should include 'ws' when WebSocket transport is registered", async () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: ["ws"] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			const body = (await res.json()) as { data: { transports: string[] } };
			expect(body.data.transports).toContain("ws");
		});

		it("should include 'sse' when SSE transport is registered", async () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: ["sse"] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			const body = (await res.json()) as { data: { transports: string[] } };
			expect(body.data.transports).toContain("sse");
		});

		it("should include 'polling' when polling transport is registered", async () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: ["polling"] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			const body = (await res.json()) as { data: { transports: string[] } };
			expect(body.data.transports).toContain("polling");
		});

		it("should return all registered transports when all three are configured", async () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: ["ws", "sse", "polling"] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			const res = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			const body = (await res.json()) as { data: { transports: string[] } };
			expect(body.data.transports).toContain("ws");
			expect(body.data.transports).toContain("sse");
			expect(body.data.transports).toContain("polling");
			expect(body.data.transports).toHaveLength(3);
		});

		it("should return transports in a deterministic order", async () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: ["ws", "sse", "polling"] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			const res1 = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			const res2 = await match.route.handler(
				{ params: {}, query: {}, body: undefined } as never,
				makeReq(),
			);
			const body1 = (await res1.json()) as { data: { transports: string[] } };
			const body2 = (await res2.json()) as { data: { transports: string[] } };
			expect(body1.data.transports).toEqual(body2.data.transports);
		});
	});

	// --- Auth scope ---

	describe("auth scope (public — no token required)", () => {
		it("should be registered with public auth scope", () => {
			const router = makeRouter();
			registerCapabilitiesEndpoint(router, { transports: [] });

			const match = router.match("GET", "/emito/v1/capabilities")!;
			expect(match.route.auth).toBe("public");
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: capabilities wired into createEmitoServer
// ---------------------------------------------------------------------------

describe("capabilities endpoint wired in createEmitoServer", () => {
	it("should return 200 and transports array from GET /emito/v1/capabilities without auth", async () => {
		const {
			InMemoryDeadLetterRepository,
			InMemoryInboxRepository,
			InMemoryIntegrationRepository,
			InMemoryNotificationRepository,
			InMemoryPreferenceRepository,
			InMemorySubscriberRepository,
			InMemoryConsentRepository,
			InMemorySuppressionRepository,
			InMemoryWorkspaceDefaultRepository,
		} = await import("@emito/core");
		const { createEmitoServer } = await import("../../handler.js");

		const server = createEmitoServer({
			emito: {
				send: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
				healthCheck: vi
					.fn()
					.mockResolvedValue({ healthy: true, providers: [], redis: { connected: true } }),
				on: vi.fn(),
				off: vi.fn(),
			} as never,
			apiKey: "test-key",
			repositories: {
				subscriberRepository: new InMemorySubscriberRepository(),
				notificationRepository: new InMemoryNotificationRepository(),
				preferenceRepository: new InMemoryPreferenceRepository(),
				consentRepository: new InMemoryConsentRepository(),
				workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
				suppressionRepository: new InMemorySuppressionRepository(),
				deadLetterRepository: new InMemoryDeadLetterRepository(),
				integrationRepository: new InMemoryIntegrationRepository(),
				inboxRepository: new InMemoryInboxRepository(),
			},
			resolveSubscriberId: vi.fn().mockResolvedValue("sub_1"),
		});

		const res = await server.handler(new Request("http://localhost/emito/v1/capabilities"));
		expect(res.status).toBe(200);

		const body = (await res.json()) as { data: { transports: string[] } };
		expect(Array.isArray(body.data.transports)).toBe(true);
		// SSE and polling are always registered; WS may depend on config
		// Verify each item in the array is a known transport string
		for (const t of body.data.transports) {
			expect(["ws", "sse", "polling"]).toContain(t);
		}
	});

	it("should not require an Authorization header on GET /emito/v1/capabilities", async () => {
		const {
			InMemoryDeadLetterRepository,
			InMemoryInboxRepository,
			InMemoryIntegrationRepository,
			InMemoryNotificationRepository,
			InMemoryPreferenceRepository,
			InMemorySubscriberRepository,
			InMemoryConsentRepository,
			InMemorySuppressionRepository,
			InMemoryWorkspaceDefaultRepository,
		} = await import("@emito/core");
		const { createEmitoServer } = await import("../../handler.js");

		const resolveSubscriberId = vi.fn().mockResolvedValue(null); // always rejects
		const server = createEmitoServer({
			emito: {
				send: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
				healthCheck: vi
					.fn()
					.mockResolvedValue({ healthy: true, providers: [], redis: { connected: true } }),
				on: vi.fn(),
				off: vi.fn(),
			} as never,
			apiKey: "test-key",
			repositories: {
				subscriberRepository: new InMemorySubscriberRepository(),
				notificationRepository: new InMemoryNotificationRepository(),
				preferenceRepository: new InMemoryPreferenceRepository(),
				consentRepository: new InMemoryConsentRepository(),
				workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
				suppressionRepository: new InMemorySuppressionRepository(),
				deadLetterRepository: new InMemoryDeadLetterRepository(),
				integrationRepository: new InMemoryIntegrationRepository(),
				inboxRepository: new InMemoryInboxRepository(),
			},
			resolveSubscriberId,
		});

		const res = await server.handler(new Request("http://localhost/emito/v1/capabilities"));
		// Public endpoint — must not call resolveSubscriberId at all
		expect(resolveSubscriberId).not.toHaveBeenCalled();
		expect(res.status).toBe(200);
	});
});
