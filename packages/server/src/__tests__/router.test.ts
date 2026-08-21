import { describe, expect, it } from "vitest";
import { jsonResponse } from "../response.js";
import { createRouter } from "../router.js";

const noop = async () => jsonResponse({ ok: true });

describe("createRouter", () => {
	describe("match", () => {
		it("matches a simple static path", () => {
			const router = createRouter("/emito");
			router.add({ method: "GET", pathPattern: "/health", handler: noop, auth: "public" });
			const result = router.match("GET", "/emito/health");
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({});
		});

		it("returns null for unmatched path", () => {
			const router = createRouter("/emito");
			router.add({ method: "GET", pathPattern: "/health", handler: noop, auth: "public" });
			expect(router.match("GET", "/emito/unknown")).toBeNull();
		});

		it("returns null for unmatched method", () => {
			const router = createRouter("/emito");
			router.add({ method: "GET", pathPattern: "/health", handler: noop, auth: "public" });
			expect(router.match("POST", "/emito/health")).toBeNull();
		});

		it("extracts path params", () => {
			const router = createRouter("/emito");
			router.add({
				method: "POST",
				pathPattern: "/notifications/:id/read",
				handler: noop,
				auth: "subscriber",
			});
			const result = router.match("POST", "/emito/notifications/ntf_abc123/read");
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({ id: "ntf_abc123" });
		});

		it("extracts multiple path params", () => {
			const router = createRouter("/emito");
			router.add({
				method: "PUT",
				pathPattern: "/workspace/:wsId/integrations/:id",
				handler: noop,
				auth: "workspace",
			});
			const result = router.match("PUT", "/emito/workspace/ws_123/integrations/int_456");
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({ wsId: "ws_123", id: "int_456" });
		});

		it("decodes URI-encoded path params", () => {
			const router = createRouter("/emito");
			router.add({ method: "GET", pathPattern: "/items/:name", handler: noop, auth: "public" });
			const result = router.match("GET", "/emito/items/hello%20world");
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({ name: "hello world" });
		});

		it("does not match extra trailing segments", () => {
			const router = createRouter("/emito");
			router.add({ method: "GET", pathPattern: "/health", handler: noop, auth: "public" });
			expect(router.match("GET", "/emito/health/extra")).toBeNull();
		});

		it("does not match shorter paths", () => {
			const router = createRouter("/emito");
			router.add({
				method: "POST",
				pathPattern: "/notifications/:id/read",
				handler: noop,
				auth: "subscriber",
			});
			expect(router.match("POST", "/emito/notifications")).toBeNull();
		});
	});

	describe("trailing slash normalization (D-016)", () => {
		it("matches a path with a trailing slash via filter(Boolean)", () => {
			const router = createRouter("/emito");
			router.add({ method: "GET", pathPattern: "/health", handler: noop, auth: "public" });
			// filter(Boolean) in matchPath strips the empty segment from the trailing slash
			expect(router.match("GET", "/emito/health/")).not.toBeNull();
		});

		it("matches a path param route with a trailing slash", () => {
			const router = createRouter("/emito");
			router.add({
				method: "GET",
				pathPattern: "/notifications/:id",
				handler: noop,
				auth: "subscriber",
			});
			const result = router.match("GET", "/emito/notifications/ntf_abc123/");
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({ id: "ntf_abc123" });
		});

		it("matches a path with double trailing slash", () => {
			const router = createRouter("/emito");
			router.add({ method: "GET", pathPattern: "/health", handler: noop, auth: "public" });
			// Both trailing empty segments are filtered out
			expect(router.match("GET", "/emito/health//")).not.toBeNull();
		});
	});

	describe("configurable prefix", () => {
		it("uses custom prefix", () => {
			const router = createRouter("/api/notifications");
			router.add({ method: "GET", pathPattern: "/health", handler: noop, auth: "public" });
			expect(router.match("GET", "/api/notifications/health")).not.toBeNull();
			expect(router.match("GET", "/emito/health")).toBeNull();
		});

		it("matches first matching route in order", () => {
			const router = createRouter("/emito");
			const handler1 = async () => jsonResponse({ first: true });
			const handler2 = async () => jsonResponse({ second: true });
			router.add({ method: "GET", pathPattern: "/items/:id", handler: handler1, auth: "public" });
			router.add({ method: "GET", pathPattern: "/items/:name", handler: handler2, auth: "public" });
			const result = router.match("GET", "/emito/items/abc");
			expect(result).not.toBeNull();
			expect(result!.route.handler).toBe(handler1);
		});
	});

	describe("API versioning", () => {
		it("inserts the version segment between the prefix and the route", () => {
			const router = createRouter("/emito", "v1");
			router.add({
				method: "GET",
				pathPattern: "/notifications",
				handler: noop,
				auth: "subscriber",
			});
			expect(router.match("GET", "/emito/v1/notifications")).not.toBeNull();
			expect(router.match("GET", "/emito/notifications")).toBeNull();
		});

		it("keeps the version when the host mounts on a custom prefix", () => {
			const router = createRouter("/api/notifications", "v1");
			router.add({
				method: "GET",
				pathPattern: "/notifications",
				handler: noop,
				auth: "subscriber",
			});
			expect(router.match("GET", "/api/notifications/v1/notifications")).not.toBeNull();
		});

		it("omits the version entirely when none is configured", () => {
			const router = createRouter("/emito/admin-api");
			router.add({ method: "GET", pathPattern: "/admin/lists", handler: noop, auth: "admin" });
			expect(router.match("GET", "/emito/admin-api/admin/lists")).not.toBeNull();
		});

		it("mounts an unversioned route directly under the prefix", () => {
			const router = createRouter("/emito", "v1");
			router.add({
				method: "GET",
				pathPattern: "/health",
				handler: noop,
				auth: "public",
				unversioned: true,
			});
			expect(router.match("GET", "/emito/health")).not.toBeNull();
			expect(router.match("GET", "/emito/v1/health")).toBeNull();
		});

		it("keeps versioned and unversioned routes side by side", () => {
			const router = createRouter("/emito", "v1");
			router.add({
				method: "GET",
				pathPattern: "/health",
				handler: noop,
				auth: "public",
				unversioned: true,
			});
			router.add({
				method: "GET",
				pathPattern: "/notifications",
				handler: noop,
				auth: "subscriber",
			});
			expect(router.match("GET", "/emito/health")).not.toBeNull();
			expect(router.match("GET", "/emito/v1/notifications")).not.toBeNull();
		});
	});
});
