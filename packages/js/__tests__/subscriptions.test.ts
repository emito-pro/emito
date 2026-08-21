import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { SubscriptionsApi } from "../src/api/subscriptions.js";

function makeHttpClient(mockRequest: ReturnType<typeof vi.fn>): HttpClient {
	const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });
	client.request = mockRequest;
	return client;
}

describe("SubscriptionsApi", () => {
	let requestMock: ReturnType<typeof vi.fn>;
	let api: SubscriptionsApi;

	beforeEach(() => {
		requestMock = vi.fn();
		const http = makeHttpClient(requestMock);
		api = new SubscriptionsApi(http);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("list", () => {
		it("should call GET /subscriptions", async () => {
			requestMock.mockResolvedValue({ items: [], hasMore: false });

			const result = await api.list();

			expect(requestMock).toHaveBeenCalledWith({
				method: "GET",
				path: "/subscriptions",
			});
			expect(result).toEqual({ items: [], hasMore: false });
		});

		it("should return subscription items", async () => {
			const items = [
				{ slug: "newsletter", name: "Weekly Newsletter", subscribedAt: "2026-01-01T00:00:00.000Z" },
				{ slug: "promotions", name: "Promotions", subscribedAt: "2026-02-01T00:00:00.000Z" },
			];
			requestMock.mockResolvedValue({ items, hasMore: false });

			const result = await api.list();

			expect(result.items).toHaveLength(2);
			expect(result.items[0]!.slug).toBe("newsletter");
		});
	});

	describe("subscribe", () => {
		it("should call POST /lists/:slug/subscribe", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.subscribe("newsletter");

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/lists/newsletter/subscribe",
			});
		});

		it("should URL-encode list slug with special characters", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.subscribe("my-list/v2");

			const call = requestMock.mock.calls[0]![0];
			expect(call.path).toContain(encodeURIComponent("my-list/v2"));
		});
	});

	describe("unsubscribe", () => {
		it("should call POST /lists/:slug/unsubscribe", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.unsubscribe("newsletter");

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/lists/newsletter/unsubscribe",
			});
		});
	});
});
