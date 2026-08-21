import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "../src/api/notifications.js";
import { EmitoClient } from "../src/client.js";

// Mock WebSocket for WS adapter
class MockWebSocket {
	static instances: MockWebSocket[] = [];
	readyState = 0;
	onopen: ((ev: Event) => void) | null = null;
	onmessage: ((ev: MessageEvent) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;
	onclose: ((ev: CloseEvent) => void) | null = null;
	url: string;

	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
	}

	close(): void {
		this.readyState = 3;
	}

	simulateOpen(): void {
		this.readyState = 1;
		this.onopen?.(new Event("open"));
	}

	simulateMessage(data: unknown): void {
		this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
	}

	simulateClose(): void {
		this.readyState = 3;
		this.onclose?.({ type: "close" } as CloseEvent);
	}
}

function makeNotificationMessage(
	overrides: Partial<{ id: string; streamId: string; event: string }> = {},
) {
	const { id = "ntf_1", streamId = "100-0", event = "order.filled" } = overrides;
	return {
		type: "notification",
		id: streamId,
		data: {
			notificationId: id,
			subscriberId: "sub_1",
			event,
			body: "Order filled for $50",
			data: { amount: 50 },
			timestamp: "2026-04-01T00:00:00.000Z",
		},
	};
}

function makeFetchNotifications(items: NotificationItem[], count = 0) {
	return vi.fn().mockImplementation((url: string) => {
		if (typeof url === "string" && url.includes("/capabilities")) {
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws"] } }),
			});
		}
		if (typeof url === "string" && url.includes("/notifications/unread/count")) {
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ data: { count } }),
			});
		}
		if (typeof url === "string" && url.includes("/notifications")) {
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ data: { items, hasMore: false } }),
			});
		}
		return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
	});
}

const OriginalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;

beforeEach(() => {
	MockWebSocket.instances = [];
	vi.useFakeTimers();
	globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
	vi.useRealTimers();
	globalThis.WebSocket = OriginalWebSocket;
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

async function connectClient(client: EmitoClient): Promise<void> {
	const connectPromise = client.connect();
	await vi.advanceTimersByTimeAsync(10);
	const ws = MockWebSocket.instances[0]!;
	ws.simulateOpen();
	await connectPromise;
}

describe("EmitoClient (state + API integration)", () => {
	describe("API modules", () => {
		it("should expose notifications, preferences, integrations, subscriptions", () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			expect(client.notifications).toBeDefined();
			expect(client.preferences).toBeDefined();
			expect(client.integrations).toBeDefined();
			expect(client.subscriptions).toBeDefined();
		});

		it("should call notifications.list via REST API", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { items: [], hasMore: false } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const result = await client.notifications.list();

			expect(result).toEqual({ items: [], hasMore: false });
			expect(globalThis.fetch).toHaveBeenCalled();
		});

		it("should call notifications.unreadCount via REST API", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { count: 5 } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const count = await client.notifications.unreadCount();

			expect(count).toBe(5);
		});

		it("should call preferences.get via REST API", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { preferences: [] } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const prefs = await client.preferences.get();

			expect(prefs).toEqual([]);
		});

		it("should call subscriptions.list via REST API", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { items: [], hasMore: false } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const result = await client.subscriptions.list();

			expect(result).toEqual({ items: [], hasMore: false });
		});
	});

	describe("state management", () => {
		it("should expose getNotifications and getUnreadCount methods", () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			expect(typeof client.getNotifications).toBe("function");
			expect(typeof client.getUnreadCount).toBe("function");
		});

		it("should update state after fetchNotifications", async () => {
			const items: NotificationItem[] = [
				{
					id: "ntf_1",
					subscriberId: "sub_1",
					event: "order.filled",
					body: "Your order has been filled",
					readAt: null,
					archivedAt: null,
					snoozedUntil: null,
					createdAt: "2026-04-01T00:00:00.000Z",
				},
			];
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { items, hasMore: false } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.fetchNotifications();

			expect(client.getNotifications()).toHaveLength(1);
			expect(client.getNotifications()[0]!.id).toBe("ntf_1");
		});

		it("should update unreadCount state after fetchUnreadCount", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { count: 7 } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.fetchUnreadCount();

			expect(client.getUnreadCount()).toBe(7);
		});

		it("should emit notifications event when fetchNotifications updates state", async () => {
			const items: NotificationItem[] = [
				{
					id: "ntf_1",
					subscriberId: "sub_1",
					event: "order.filled",
					body: "Your order has been filled",
					readAt: null,
					archivedAt: null,
					snoozedUntil: null,
					createdAt: "2026-04-01T00:00:00.000Z",
				},
			];
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { items, hasMore: false } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const notifHandler = vi.fn();
			// TypeScript: event emitter has standard events; cast to any for custom state events
			(client as unknown as { on: (e: string, cb: (...args: unknown[]) => void) => void }).on(
				"notifications",
				notifHandler,
			);

			await client.fetchNotifications();

			expect(notifHandler).toHaveBeenCalledWith(items);
		});

		it("should emit unreadCount event when fetchUnreadCount updates state", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { count: 3 } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const countHandler = vi.fn();
			(client as unknown as { on: (e: string, cb: (...args: unknown[]) => void) => void }).on(
				"unreadCount",
				countHandler,
			);

			await client.fetchUnreadCount();

			expect(countHandler).toHaveBeenCalledWith(3);
		});
	});

	describe("real-time events update state", () => {
		it("should prepend notification to state on real-time WS message", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws"] } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			await connectClient(client);

			const ws = MockWebSocket.instances[0]!;
			ws.simulateMessage(makeNotificationMessage({ id: "ntf_rt_1" }));

			const notifications = client.getNotifications();
			expect(notifications).toHaveLength(1);
			expect(notifications[0]!.id).toBe("ntf_rt_1");

			client.disconnect();
		});

		it("should increment unread count on real-time notification", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws"] } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			await connectClient(client);
			expect(client.getUnreadCount()).toBe(0);

			const ws = MockWebSocket.instances[0]!;
			ws.simulateMessage(makeNotificationMessage({ id: "ntf_rt_1" }));

			expect(client.getUnreadCount()).toBe(1);

			ws.simulateMessage(makeNotificationMessage({ id: "ntf_rt_2" }));
			expect(client.getUnreadCount()).toBe(2);

			client.disconnect();
		});

		it("should fire notification event on real-time WS message", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws"] } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const notifHandler = vi.fn();
			client.on("notification", notifHandler);

			await connectClient(client);

			const ws = MockWebSocket.instances[0]!;
			ws.simulateMessage(makeNotificationMessage({ id: "ntf_rt_1", event: "order.filled" }));

			expect(notifHandler).toHaveBeenCalledWith(
				expect.objectContaining({ notificationId: "ntf_rt_1", event: "order.filled" }),
				expect.any(String),
			);

			client.disconnect();
		});

		it("should emit unreadCount event on real-time notification", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws"] } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const countHandler = vi.fn();
			(client as unknown as { on: (e: string, cb: (...args: unknown[]) => void) => void }).on(
				"unreadCount",
				countHandler,
			);

			await connectClient(client);

			const ws = MockWebSocket.instances[0]!;
			ws.simulateMessage(makeNotificationMessage({ id: "ntf_rt_1" }));

			expect(countHandler).toHaveBeenCalledWith(1);

			client.disconnect();
		});
	});

	describe("optimistic markAsRead", () => {
		it("should update state immediately before API resolves", async () => {
			let resolveMarkAsRead!: () => void;

			const items: NotificationItem[] = [
				{
					id: "ntf_1",
					subscriberId: "sub_1",
					event: "order.filled",
					body: "Your order has been filled",
					readAt: null,
					archivedAt: null,
					snoozedUntil: null,
					createdAt: "2026-04-01T00:00:00.000Z",
				},
			];
			globalThis.fetch = vi.fn().mockImplementation((url: string) => {
				if (typeof url === "string" && url.includes("/read")) {
					return new Promise<Response>(
						(res) =>
							(resolveMarkAsRead = () =>
								res({
									ok: true,
									json: () => Promise.resolve({ data: { success: true } }),
								} as Response)),
					);
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { items, hasMore: false } }),
				});
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			// Connect the client so markAsRead uses optimistic path
			await connectClient(client);

			await client.fetchNotifications();

			// markAsRead is optimistic — don't await
			const markPromise = client.markAsRead("ntf_1");

			// State updated immediately
			const n = client.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBeTruthy();
			expect(client.getUnreadCount()).toBe(0);

			resolveMarkAsRead();
			await markPromise;

			client.disconnect();
		});

		it("should revert state when API call fails", async () => {
			const items: NotificationItem[] = [
				{
					id: "ntf_1",
					subscriberId: "sub_1",
					event: "order.filled",
					body: "Your order has been filled",
					readAt: null,
					archivedAt: null,
					snoozedUntil: null,
					createdAt: "2026-04-01T00:00:00.000Z",
				},
			];
			globalThis.fetch = vi.fn().mockImplementation((url: string) => {
				if (typeof url === "string" && url.includes("/read")) {
					return Promise.resolve({
						ok: false,
						status: 500,
						json: () => Promise.resolve({ error: { message: "Internal error" } }),
					});
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { items, hasMore: false } }),
				});
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			// Connect the client so markAsRead uses optimistic path (not offline queue)
			await connectClient(client);

			await client.fetchNotifications();

			await expect(client.markAsRead("ntf_1")).rejects.toThrow();

			const n = client.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBeNull();
			expect(client.getUnreadCount()).toBe(1);

			client.disconnect();
		});
	});

	describe("archive", () => {
		it("should call the API and remove the notification from state", async () => {
			const items: NotificationItem[] = [
				{
					id: "ntf_1",
					subscriberId: "sub_1",
					event: "order.filled",
					body: "Your order has been filled",
					readAt: null,
					archivedAt: null,
					snoozedUntil: null,
					createdAt: "2026-04-01T00:00:00.000Z",
				},
			];
			const archiveCalled = vi.fn();
			globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
				if (typeof url === "string" && url.includes("/archive")) {
					archiveCalled(init?.method);
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ data: { success: true } }),
					});
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { items, hasMore: false } }),
				});
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await connectClient(client);
			await client.fetchNotifications();
			expect(client.getNotifications().find((x) => x.id === "ntf_1")).toBeDefined();

			await client.archive("ntf_1");

			expect(archiveCalled).toHaveBeenCalled();
			expect(client.getNotifications().find((x) => x.id === "ntf_1")).toBeUndefined();

			client.disconnect();
		});
	});

	describe("markAsUnread", () => {
		it("should call API and update state", async () => {
			globalThis.fetch = vi.fn().mockImplementation((url: string) => {
				if (typeof url === "string" && url.includes("/unread") && !url.includes("/count")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ data: { success: true } }),
					});
				}
				const items: NotificationItem[] = [
					{
						id: "ntf_1",
						subscriberId: "sub_1",
						event: "order.filled",
						body: "Your order has been filled",
						readAt: "2026-01-01T00:00:00.000Z",
						archivedAt: null,
						snoozedUntil: null,
						createdAt: "2026-04-01T00:00:00.000Z",
					},
				];
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { items, hasMore: false } }),
				});
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.fetchNotifications();
			await client.markAsUnread("ntf_1");

			const n = client.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBeNull();
			expect(client.getUnreadCount()).toBe(1);
		});
	});

	describe("markAllAsRead", () => {
		it("should call API and update state", async () => {
			globalThis.fetch = vi.fn().mockImplementation((url: string) => {
				if (typeof url === "string" && url.includes("/read-all")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ data: { success: true } }),
					});
				}
				const items: NotificationItem[] = [
					{
						id: "ntf_1",
						subscriberId: "sub_1",
						event: "order.filled",
						body: "Your order has been filled",
						readAt: null,
						archivedAt: null,
						snoozedUntil: null,
						createdAt: "2026-04-01T00:00:00.000Z",
					},
					{
						id: "ntf_2",
						subscriberId: "sub_1",
						event: "msg.received",
						body: "You have a new message",
						readAt: null,
						archivedAt: null,
						snoozedUntil: null,
						createdAt: "2026-04-01T00:00:00.000Z",
					},
				];
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { items, hasMore: false } }),
				});
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.fetchNotifications();
			await client.markAllAsRead();

			const notifications = client.getNotifications();
			expect(notifications.every((n) => n.readAt !== null)).toBe(true);
			expect(client.getUnreadCount()).toBe(0);
		});
	});
});
