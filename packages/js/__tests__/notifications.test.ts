import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { NotificationsApi } from "../src/api/notifications.js";

function makeHttpClient(mockRequest: ReturnType<typeof vi.fn>): HttpClient {
	const client = new HttpClient({ endpoint: "https://example.com/emito", token: "tok" });
	client.request = mockRequest;
	return client;
}

describe("NotificationsApi", () => {
	let requestMock: ReturnType<typeof vi.fn>;
	let api: NotificationsApi;

	beforeEach(() => {
		requestMock = vi.fn();
		const http = makeHttpClient(requestMock);
		api = new NotificationsApi(http);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("list", () => {
		it("should call GET /notifications with no params", async () => {
			requestMock.mockResolvedValue({ items: [], hasMore: false });

			const result = await api.list();

			expect(requestMock).toHaveBeenCalledWith({
				method: "GET",
				path: "/notifications",
				query: undefined,
			});
			expect(result).toEqual({ items: [], hasMore: false });
		});

		it("should pass filter params as query when provided", async () => {
			requestMock.mockResolvedValue({ items: [], hasMore: false });

			await api.list({ status: "unread", limit: 10, cursor: "abc" });

			expect(requestMock).toHaveBeenCalledWith({
				method: "GET",
				path: "/notifications",
				query: { status: "unread", limit: 10, cursor: "abc" },
			});
		});

		it("should return list result with items and hasMore", async () => {
			const items = [
				{
					id: "ntf_1",
					subscriberId: "sub_1",
					event: "order.filled",
					body: "Your order has been filled",
					createdAt: "2026-04-01T00:00:00.000Z",
					readAt: null,
					archivedAt: null,
					snoozedUntil: null,
				},
			];
			requestMock.mockResolvedValue({ items, hasMore: true, cursor: "cursor_next" });

			const result = await api.list();

			expect(result.items).toHaveLength(1);
			expect(result.hasMore).toBe(true);
			expect(result.cursor).toBe("cursor_next");
		});
	});

	describe("unreadCount", () => {
		it("should call GET /notifications/unread/count", async () => {
			requestMock.mockResolvedValue({ count: 5 });

			const count = await api.unreadCount();

			expect(requestMock).toHaveBeenCalledWith({
				method: "GET",
				path: "/notifications/unread/count",
			});
			expect(count).toBe(5);
		});

		it("should return 0 when no unread notifications", async () => {
			requestMock.mockResolvedValue({ count: 0 });

			const count = await api.unreadCount();

			expect(count).toBe(0);
		});
	});

	describe("markAsRead", () => {
		it("should call POST /notifications/:id/read", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.markAsRead("ntf_abc123");

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/notifications/ntf_abc123/read",
			});
		});

		it("should URL-encode notification ID with special characters", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.markAsRead("ntf abc/123");

			const call = requestMock.mock.calls[0]![0];
			expect(call.path).toContain(encodeURIComponent("ntf abc/123"));
		});
	});

	describe("markAsUnread", () => {
		it("should call POST /notifications/:id/unread", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.markAsUnread("ntf_abc123");

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/notifications/ntf_abc123/unread",
			});
		});
	});

	describe("archive", () => {
		it("should call POST /notifications/:id/archive", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.archive("ntf_abc123");

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/notifications/ntf_abc123/archive",
			});
		});
	});

	describe("unarchive", () => {
		it("should call POST /notifications/:id/unarchive", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.unarchive("ntf_abc123");

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/notifications/ntf_abc123/unarchive",
			});
		});
	});

	describe("snooze", () => {
		it("should call POST /notifications/:id/snooze with ISO date body", async () => {
			requestMock.mockResolvedValue({ success: true });
			const until = new Date("2026-05-01T09:00:00.000Z");

			await api.snooze("ntf_abc123", until);

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/notifications/ntf_abc123/snooze",
				body: { until: "2026-05-01T09:00:00.000Z" },
			});
		});
	});

	describe("markAllAsRead", () => {
		it("should call POST /notifications/read-all", async () => {
			requestMock.mockResolvedValue({ success: true });

			await api.markAllAsRead();

			expect(requestMock).toHaveBeenCalledWith({
				method: "POST",
				path: "/notifications/read-all",
			});
		});
	});
});
