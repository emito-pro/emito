import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/api/http.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
	vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
	vi.restoreAllMocks();
	globalThis.fetch = originalFetch;
});

function makeFetchOk(data: unknown) {
	return vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve({ data }),
	});
}

function makeFetchError(status: number, errorBody?: unknown) {
	return vi.fn().mockResolvedValue({
		ok: false,
		status,
		json: () => Promise.resolve(errorBody ?? {}),
	});
}

describe("HttpClient", () => {
	describe("request", () => {
		it("should include Authorization header on GET request", async () => {
			globalThis.fetch = makeFetchOk({ items: [] });
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "test-jwt" });

			await client.request({ method: "GET", path: "/notifications" });

			expect(globalThis.fetch).toHaveBeenCalledWith(
				"https://example.com/emito/notifications",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer test-jwt",
					}),
				}),
			);
		});

		it("uses getToken for the Authorization header when provided", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
			globalThis.fetch = fetchMock;
			let current = "tok_a";
			const http = new HttpClient({
				endpoint: "http://x/emito",
				getToken: async () => current,
			});

			await http.request({ path: "/notifications", method: "GET" });
			expect(fetchMock).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: "Bearer tok_a" }),
				}),
			);

			current = "tok_b";
			await http.request({ path: "/notifications", method: "GET" });
			expect(fetchMock).toHaveBeenLastCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: "Bearer tok_b" }),
				}),
			);
		});

		it("should include Content-Type header and JSON body on POST request", async () => {
			globalThis.fetch = makeFetchOk({ success: true });
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await client.request({
				method: "POST",
				path: "/notifications/ntf_1/read",
				body: { foo: "bar" },
			});

			expect(globalThis.fetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
					}),
					body: JSON.stringify({ foo: "bar" }),
				}),
			);
		});

		it("should strip trailing slash from endpoint", async () => {
			globalThis.fetch = makeFetchOk({ count: 0 });
			const client = new HttpClient({ endpoint: "https://example.com/emito/", token: "tok" });

			await client.request({ method: "GET", path: "/notifications/unread/count" });

			const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
			expect(calledUrl).toBe("https://example.com/emito/notifications/unread/count");
		});

		it("should append query params to URL", async () => {
			globalThis.fetch = makeFetchOk({ items: [], hasMore: false });
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await client.request({
				method: "GET",
				path: "/notifications",
				query: { status: "unread", limit: 20, cursor: undefined },
			});

			const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
			const url = new URL(calledUrl);
			expect(url.searchParams.get("status")).toBe("unread");
			expect(url.searchParams.get("limit")).toBe("20");
			expect(url.searchParams.has("cursor")).toBe(false);
		});

		it("should return data from response json", async () => {
			const expected = { count: 7 };
			globalThis.fetch = makeFetchOk(expected);
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			const result = await client.request({ method: "GET", path: "/notifications/unread/count" });

			expect(result).toEqual(expected);
		});

		it("should throw TRANSPORT_CONNECTION_FAILED when fetch rejects (network error)", async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network offline"));
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(client.request({ method: "GET", path: "/notifications" })).rejects.toMatchObject(
				{
					code: "TRANSPORT_CONNECTION_FAILED",
					isRetryable: true,
				},
			);
		});

		it("should throw VALIDATION_ERROR on HTTP 400", async () => {
			globalThis.fetch = makeFetchError(400, { error: { message: "bad input" } });
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(client.request({ method: "GET", path: "/notifications" })).rejects.toMatchObject(
				{
					code: "VALIDATION_ERROR",
					statusCode: 400,
					isRetryable: false,
				},
			);
		});

		it("should throw AUTH_INVALID_TOKEN on HTTP 401", async () => {
			globalThis.fetch = makeFetchError(401);
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(client.request({ method: "GET", path: "/notifications" })).rejects.toMatchObject(
				{
					code: "AUTH_INVALID_TOKEN",
					statusCode: 401,
					isRetryable: false,
				},
			);
		});

		it("should throw AUTH_INSUFFICIENT_ROLE on HTTP 403", async () => {
			globalThis.fetch = makeFetchError(403);
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(client.request({ method: "GET", path: "/notifications" })).rejects.toMatchObject(
				{
					code: "AUTH_INSUFFICIENT_ROLE",
					statusCode: 403,
					isRetryable: false,
				},
			);
		});

		it("should throw RESOURCE_NOT_FOUND on HTTP 404", async () => {
			globalThis.fetch = makeFetchError(404);
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(
				client.request({ method: "GET", path: "/notifications/bad" }),
			).rejects.toMatchObject({
				code: "RESOURCE_NOT_FOUND",
				statusCode: 404,
				isRetryable: false,
			});
		});

		it("should throw RESOURCE_CONFLICT on HTTP 409", async () => {
			globalThis.fetch = makeFetchError(409);
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(client.request({ method: "POST", path: "/integrations" })).rejects.toMatchObject(
				{
					code: "RESOURCE_CONFLICT",
					statusCode: 409,
					isRetryable: false,
				},
			);
		});

		it("should throw RATE_LIMITED on HTTP 429 with isRetryable true", async () => {
			globalThis.fetch = makeFetchError(429);
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(client.request({ method: "GET", path: "/notifications" })).rejects.toMatchObject(
				{
					code: "RATE_LIMITED",
					statusCode: 429,
					isRetryable: true,
				},
			);
		});

		it("should throw INTERNAL_ERROR on HTTP 500 with isRetryable true", async () => {
			globalThis.fetch = makeFetchError(500);
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(client.request({ method: "GET", path: "/notifications" })).rejects.toMatchObject(
				{
					code: "INTERNAL_ERROR",
					statusCode: 500,
					isRetryable: true,
				},
			);
		});

		it("should use server-provided error code when present in error body", async () => {
			globalThis.fetch = makeFetchError(422, {
				error: { code: "SUPPRESSED_ADDRESS", message: "Address suppressed" },
			});
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(
				client.request({ method: "POST", path: "/notifications" }),
			).rejects.toMatchObject({
				code: "SUPPRESSED_ADDRESS",
			});
		});

		it("should handle non-JSON error body gracefully", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 503,
				json: () => Promise.reject(new Error("not json")),
			});
			const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });

			await expect(client.request({ method: "GET", path: "/notifications" })).rejects.toMatchObject(
				{
					statusCode: 503,
				},
			);
		});
	});

	describe("relative endpoint resolution", () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("throws on a relative endpoint outside a browser", async () => {
			globalThis.fetch = makeFetchOk({ items: [] });
			const client = new HttpClient({ endpoint: "/emito", token: "test-jwt" });

			await expect(client.request({ method: "GET", path: "/notifications" })).rejects.toThrow();
		});

		it("resolves a relative endpoint against window.location.origin in a browser", async () => {
			vi.stubGlobal("window", { location: { origin: "https://myapp.com" } });
			globalThis.fetch = makeFetchOk({ items: [] });
			const client = new HttpClient({ endpoint: "/emito", token: "test-jwt" });

			await client.request({ method: "GET", path: "/notifications" });

			expect(globalThis.fetch).toHaveBeenCalledWith(
				"https://myapp.com/emito/notifications",
				expect.anything(),
			);
		});

		it("still honors an absolute endpoint in a browser", async () => {
			vi.stubGlobal("window", { location: { origin: "https://myapp.com" } });
			globalThis.fetch = makeFetchOk({ items: [] });
			const client = new HttpClient({ endpoint: "https://api.example.com/emito", token: "test-jwt" });

			await client.request({ method: "GET", path: "/notifications" });

			expect(globalThis.fetch).toHaveBeenCalledWith(
				"https://api.example.com/emito/notifications",
				expect.anything(),
			);
		});
	});
});
