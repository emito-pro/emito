import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { IntegrationsApi } from "../src/api/integrations.js";

function makeHttpClient(mockRequest: ReturnType<typeof vi.fn>): HttpClient {
	const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });
	client.request = mockRequest;
	return client;
}

describe("IntegrationsApi", () => {
	let requestMock: ReturnType<typeof vi.fn>;
	let api: IntegrationsApi;

	beforeEach(() => {
		requestMock = vi.fn();
		const http = makeHttpClient(requestMock);
		api = new IntegrationsApi(http);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("list", () => {
		it("should call GET /integrations", async () => {
			requestMock.mockResolvedValue({ items: [], hasMore: false });

			const result = await api.list();

			expect(requestMock).toHaveBeenCalledWith({
				method: "GET",
				path: "/integrations",
			});
			expect(result).toEqual({ items: [], hasMore: false });
		});

		it("should return integration items", async () => {
			const items = [
				{
					id: "int_1",
					subscriberId: "sub_1",
					channel: "email",
					name: "My Gmail",
					events: ["order.filled"],
					config: { email: "user@gmail.com" },
					active: true,
					createdAt: "2026-04-01T00:00:00.000Z",
				},
			];
			requestMock.mockResolvedValue({ items, hasMore: false });

			const result = await api.list();

			expect(result.items).toHaveLength(1);
			expect(result.items[0]!.id).toBe("int_1");
		});
	});

	describe("create", () => {
		it("should call POST /integrations with params", async () => {
			const created = {
				id: "int_new",
				subscriberId: "sub_1",
				channel: "email",
				name: "Telegram",
				events: ["order.filled"],
				config: { chatId: "12345" },
				active: true,
				createdAt: "2026-04-01T00:00:00.000Z",
			};
			requestMock.mockResolvedValue(created);

			const result = await api.create({
				channel: "email",
				name: "Telegram",
				events: ["order.filled"],
				config: { chatId: "12345" },
			});

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/integrations",
				body: {
					channel: "email",
					name: "Telegram",
					events: ["order.filled"],
					config: { chatId: "12345" },
				},
			});
			expect(result).toEqual(created);
		});
	});

	describe("update", () => {
		it("should call PUT /integrations/:id with update params", async () => {
			const updated = {
				id: "int_1",
				subscriberId: "sub_1",
				channel: "email",
				name: "Updated Name",
				events: ["order.filled"],
				config: {},
				active: true,
				createdAt: "2026-04-01T00:00:00.000Z",
			};
			requestMock.mockResolvedValue(updated);

			const result = await api.update("int_1", { name: "Updated Name" });

			expect(requestMock).toHaveBeenCalledWith({
				method: "PUT",
				path: "/integrations/int_1",
				body: { name: "Updated Name" },
			});
			expect(result).toEqual(updated);
		});

		it("should URL-encode integration ID with special characters", async () => {
			requestMock.mockResolvedValue({
				id: "int/1",
				subscriberId: "",
				channel: "email",
				name: "",
				events: [],
				config: {},
				active: true,
				createdAt: "",
			});

			await api.update("int/1", {});

			const call = requestMock.mock.calls[0]![0];
			expect(call.path).toContain(encodeURIComponent("int/1"));
		});
	});

	describe("deactivate", () => {
		it("should call POST /integrations/:id/deactivate", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.deactivate("int_1");

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/integrations/int_1/deactivate",
			});
		});
	});
});
