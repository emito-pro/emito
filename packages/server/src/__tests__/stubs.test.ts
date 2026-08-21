/**
 * Tests for stub endpoints, health endpoint, metrics endpoint, and validation utilities.
 *
 * Rules applied:
 * - Assert on specific error codes (rule 1)
 * - Assert statusCode (rule 3)
 * - Test boundary conditions (rule 4)
 * - Follow describe/it naming (rule 15)
 * - Assert on shape of return values (rule 26)
 */

import { describe, expect, it, vi } from "vitest";
import { registerHealthEndpoint } from "../endpoints/health.js";
import { registerMetricsEndpoint } from "../endpoints/metrics.js";
import { registerStubEndpoints } from "../endpoints/stubs.js";
import { parseQueryString } from "../query.js";
import { jsonResponse } from "../response.js";
import { createRouter } from "../router.js";

function noop() {
	return Promise.resolve(jsonResponse({ ok: true }));
}

function makeRouter(prefix = "/emito") {
	return createRouter(prefix);
}

function mockEmito(healthy = true) {
	return {
		send: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		healthCheck: vi.fn().mockResolvedValue({
			healthy,
			providers: [],
			redis: { connected: healthy },
		}),
		on: vi.fn(),
		off: vi.fn(),
	};
}

const EMPTY_CTX = { params: {}, query: {}, body: undefined };

// ---------------------------------------------------------------------------
// registerStubEndpoints
// ---------------------------------------------------------------------------

describe("registerStubEndpoints", () => {
	it("should register no stub routes when all stubs are implemented", () => {
		const router = makeRouter();
		registerStubEndpoints(router);

		expect(router.match("POST", "/emito/v1/admin/broadcast")).toBeNull();
	});

	it("should NOT register removed list stubs (replaced by real endpoints)", () => {
		const router = makeRouter();
		registerStubEndpoints(router);
		expect(router.match("GET", "/emito/v1/subscriptions")).toBeNull();
		expect(router.match("POST", "/emito/v1/lists/newsletter/subscribe")).toBeNull();
		expect(router.match("POST", "/emito/v1/lists/newsletter/unsubscribe")).toBeNull();
		expect(router.match("GET", "/emito/v1/admin/lists")).toBeNull();
		expect(router.match("POST", "/emito/v1/admin/lists")).toBeNull();
		expect(router.match("PUT", "/emito/v1/admin/lists/list_1")).toBeNull();
		expect(router.match("POST", "/emito/v1/admin/lists/list_1/archive")).toBeNull();
	});

	it("should NOT register /ws as a stub (implemented in 005e)", () => {
		const router = makeRouter();
		registerStubEndpoints(router);
		expect(router.match("GET", "/emito/v1/ws")).toBeNull();
	});

	it("should NOT register broadcast stub (replaced by real endpoint in 007b task-2)", () => {
		const router = makeRouter();
		registerStubEndpoints(router);
		expect(router.match("POST", "/emito/v1/admin/broadcast")).toBeNull();
	});

	it("should NOT register tracking routes as stubs (implemented in 005d task-2)", () => {
		const router = makeRouter();
		registerStubEndpoints(router);
		expect(router.match("GET", "/emito/track/open/ntf_1")).toBeNull();
		expect(router.match("GET", "/emito/track/click/ntf_1/0")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// registerHealthEndpoint
// ---------------------------------------------------------------------------

describe("registerHealthEndpoint", () => {
	it("should register a GET /health route", () => {
		const router = makeRouter();
		registerHealthEndpoint(router, mockEmito() as never);
		expect(router.match("GET", "/emito/health")).not.toBeNull();
	});

	it("should return 200 and call emito.healthCheck when healthy", async () => {
		const router = makeRouter();
		const emito = mockEmito(true);
		registerHealthEndpoint(router, emito as never);

		const match = router.match("GET", "/emito/health")!;
		const res = await match.route.handler(EMPTY_CTX as never, new Request("http://localhost"));
		expect(res.status).toBe(200);
		expect(emito.healthCheck).toHaveBeenCalledOnce();
	});

	it("should return 503 when emito.healthCheck returns unhealthy", async () => {
		const router = makeRouter();
		const emito = mockEmito(false);
		registerHealthEndpoint(router, emito as never);

		const match = router.match("GET", "/emito/health")!;
		const res = await match.route.handler(EMPTY_CTX as never, new Request("http://localhost"));
		expect(res.status).toBe(503);
	});

	it("should return health data in the response body", async () => {
		const router = makeRouter();
		const emito = mockEmito(true);
		registerHealthEndpoint(router, emito as never);

		const match = router.match("GET", "/emito/health")!;
		const res = await match.route.handler(EMPTY_CTX as never, new Request("http://localhost"));
		const body = (await res.json()) as { data: { healthy: boolean } };
		expect(body.data.healthy).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// registerMetricsEndpoint
// ---------------------------------------------------------------------------

describe("registerMetricsEndpoint", () => {
	it("should register a GET /metrics route", () => {
		const router = makeRouter();
		registerMetricsEndpoint(router);
		expect(router.match("GET", "/emito/metrics")).not.toBeNull();
	});

	it("should return text/plain fallback when no renderer is provided", async () => {
		const router = makeRouter();
		registerMetricsEndpoint(router);

		const match = router.match("GET", "/emito/metrics")!;
		const res = await match.route.handler(EMPTY_CTX as never, new Request("http://localhost"));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/plain");
	});

	it("should call metricsRenderer when provided", async () => {
		const router = makeRouter();
		const metricsRenderer = vi.fn().mockResolvedValue("# HELP my_metric A gauge\n");
		registerMetricsEndpoint(router, metricsRenderer);

		const match = router.match("GET", "/emito/metrics")!;
		const res = await match.route.handler(EMPTY_CTX as never, new Request("http://localhost"));
		expect(metricsRenderer).toHaveBeenCalledOnce();
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("my_metric");
	});
});

// ---------------------------------------------------------------------------
// parseQueryString
// ---------------------------------------------------------------------------

describe("parseQueryString", () => {
	it("should parse search params into a record", () => {
		const url = new URL("http://localhost/emito/v1/notifications?status=unread&limit=25");
		expect(parseQueryString(url)).toEqual({ status: "unread", limit: "25" });
	});

	it("should return empty record for URL with no query params", () => {
		const url = new URL("http://localhost/emito/health");
		expect(parseQueryString(url)).toEqual({});
	});

	it("should handle multiple params", () => {
		const url = new URL("http://localhost/path?cursor=abc&limit=10");
		expect(parseQueryString(url)).toMatchObject({ cursor: "abc", limit: "10" });
	});

	it("should preserve duplicate keys as arrays", () => {
		const url = new URL("http://localhost/path?tag=a&tag=b&single=x");
		expect(parseQueryString(url)).toEqual({ tag: ["a", "b"], single: "x" });
	});

	it("should keep single values as strings, not arrays", () => {
		const url = new URL("http://localhost/path?key=value");
		expect(parseQueryString(url)).toEqual({ key: "value" });
	});
});
