import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { PreferencesApi } from "../src/api/preferences.js";

function makeHttpClient(mockRequest: ReturnType<typeof vi.fn>): HttpClient {
	const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });
	client.request = mockRequest;
	return client;
}

describe("PreferencesApi", () => {
	let requestMock: ReturnType<typeof vi.fn>;
	let api: PreferencesApi;

	beforeEach(() => {
		requestMock = vi.fn();
		const http = makeHttpClient(requestMock);
		api = new PreferencesApi(http);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("get", () => {
		it("should call GET /preferences and return preferences array", async () => {
			const prefs = [{ topicKey: "newsletter", channel: "email", enabled: true }];
			requestMock.mockResolvedValue({ preferences: prefs });

			const result = await api.get();

			expect(requestMock).toHaveBeenCalledWith({
				method: "GET",
				path: "/preferences",
			});
			expect(result).toEqual(prefs);
		});
	});

	describe("update", () => {
		it("should call PUT /preferences with update params", async () => {
			const updated = { topicKey: "newsletter", channel: "email", enabled: false };
			requestMock.mockResolvedValue(updated);

			const result = await api.update({ topicKey: "newsletter", channel: "email", enabled: false });

			expect(requestMock).toHaveBeenCalledWith({
				method: "PUT",
				path: "/preferences",
				body: { topicKey: "newsletter", channel: "email", enabled: false },
			});
			expect(result).toEqual(updated);
		});
	});

	describe("reset", () => {
		it("should call POST /preferences/reset", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.reset();

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/preferences/reset",
			});
		});
	});

	describe("getForWorkspace", () => {
		it("should call GET /workspace/:wsId/preferences", async () => {
			requestMock.mockResolvedValue({ preferences: [] });

			await api.getForWorkspace("ws_456");

			expect(requestMock).toHaveBeenCalledWith({
				method: "GET",
				path: "/workspace/ws_456/preferences",
			});
		});

		it("should URL-encode workspace ID with special characters", async () => {
			requestMock.mockResolvedValue({ preferences: [] });

			await api.getForWorkspace("ws/special id");

			const call = requestMock.mock.calls[0]![0];
			expect(call.path).toContain(encodeURIComponent("ws/special id"));
		});
	});

	describe("updateForWorkspace", () => {
		it("should call PUT /workspace/:wsId/preferences with params", async () => {
			const updated = { topicKey: "alerts", channel: "sms", enabled: true };
			requestMock.mockResolvedValue(updated);

			const result = await api.updateForWorkspace("ws_456", {
				topicKey: "alerts",
				channel: "sms",
				enabled: true,
			});

			expect(requestMock).toHaveBeenCalledWith({
				method: "PUT",
				path: "/workspace/ws_456/preferences",
				body: { topicKey: "alerts", channel: "sms", enabled: true },
			});
			expect(result).toEqual(updated);
		});
	});
});
