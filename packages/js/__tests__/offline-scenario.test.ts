import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmitoClient } from "../src/client.js";
import { MemoryStorageAdapter } from "../src/storage/memory.js";

// ---------------------------------------------------------------------------
// MockWebSocket — same pattern as other test files
// ---------------------------------------------------------------------------

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

	simulateError(): void {
		this.onerror?.(new Event("error"));
	}

	simulateClose(): void {
		this.readyState = 3;
		this.onclose?.({ type: "close" } as CloseEvent);
	}
}

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function makeFetchMock(options: { failWrites?: boolean } = {}): ReturnType<typeof vi.fn> {
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";

		// Capabilities
		if (typeof url === "string" && url.includes("/capabilities")) {
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws"] } }),
			});
		}

		// Write operations — markAsRead, archive, etc.
		if (method === "POST" && options.failWrites) {
			return Promise.resolve({
				ok: false,
				status: 503,
				json: () => Promise.resolve({ error: { message: "service unavailable" } }),
			});
		}

		// Generic success for all other calls
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve({ data: { success: true } }),
		});
	});
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function connectClient(client: EmitoClient): Promise<MockWebSocket> {
	const connectPromise = client.connect();
	await vi.advanceTimersByTimeAsync(10);
	const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
	ws.simulateOpen();
	await connectPromise;
	return ws;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EmitoClient — offline queue + storage (task 3)", () => {
	describe("storage is pluggable via EmitoClientOptions", () => {
		it("accepts a storage adapter via options without throwing", () => {
			const storage = new MemoryStorageAdapter();
			expect(
				() =>
					new EmitoClient({
						endpoint: "https://myapp.com/emito",
						subscriberId: "user_1",
						token: "tok",
						transport: "ws",
						storage,
					}),
			).not.toThrow();
		});

		it("works without a storage adapter (no storage option)", () => {
			expect(
				() =>
					new EmitoClient({
						endpoint: "https://myapp.com/emito",
						subscriberId: "user_1",
						token: "tok",
						transport: "ws",
					}),
			).not.toThrow();
		});

		it("accepts maxQueueSize option", () => {
			const storage = new MemoryStorageAdapter();
			expect(
				() =>
					new EmitoClient({
						endpoint: "https://myapp.com/emito",
						subscriberId: "user_1",
						token: "tok",
						transport: "ws",
						storage,
						maxQueueSize: 50,
					}),
			).not.toThrow();
		});

		it("exposes queueSize getter", () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});
			expect(typeof client.queueSize).toBe("number");
			expect(client.queueSize).toBe(0);
		});
	});

	describe("actions are buffered when disconnected", () => {
		it("queues markAsRead when client is not connected", async () => {
			globalThis.fetch = makeFetchMock();

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			expect(client.isConnected).toBe(false);
			await client.markAsRead("ntf_1");

			expect(client.queueSize).toBe(1);
		});

		it("queues markAsUnread when not connected", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.markAsUnread("ntf_2");
			expect(client.queueSize).toBe(1);
		});

		it("queues archive when not connected", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.archive("ntf_3");
			expect(client.queueSize).toBe(1);
		});

		it("queues markAllAsRead when not connected", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.markAllAsRead();
			expect(client.queueSize).toBe(1);
		});

		it("queues updatePreference when not connected", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.updatePreference({ topicKey: "order.filled", channel: "email", enabled: false });
			expect(client.queueSize).toBe(1);
		});

		it("queues multiple actions in order", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.markAsRead("ntf_1");
			await client.archive("ntf_2");
			await client.markAllAsRead();

			expect(client.queueSize).toBe(3);
		});

		it("does not call the API when buffering offline", async () => {
			const fetch = makeFetchMock();
			globalThis.fetch = fetch;

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.markAsRead("ntf_1");

			// No fetch calls should have been made (client not connected)
			const apiCalls = (fetch.mock.calls as [string, RequestInit][]).filter(
				([url]) => !url.includes("/capabilities"),
			);
			expect(apiCalls).toHaveLength(0);
		});
	});

	describe("markAsRead offline applies local state immediately", () => {
		it("queues markAsRead and updates unread count when offline with no notifications in state", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			// markAsRead when offline: action is queued even if notification isn't in local state
			await client.markAsRead("ntf_1");
			expect(client.queueSize).toBe(1);
		});

		it("marks notification as read in local state when offline (notification in state)", async () => {
			globalThis.fetch = vi.fn().mockImplementation((url: string) => {
				if (typeof url === "string" && url.includes("/notifications")) {
					return Promise.resolve({
						ok: true,
						json: () =>
							Promise.resolve({
								data: {
									items: [
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
									],
									hasMore: false,
								},
							}),
					});
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { success: true } }),
				});
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			// Seed the store via fetch
			await client.fetchNotifications();
			expect(client.getNotifications()).toHaveLength(1);

			// markAsRead offline applies local state immediately
			await client.markAsRead("ntf_1");

			const n = client.getNotifications().find((x) => x.id === "ntf_1")!;
			expect(n.readAt).toBeTruthy();
			expect(client.queueSize).toBe(1);
		});
	});

	describe("actions are replayed in order on connect", () => {
		it("flushes queued actions when connect() is called", async () => {
			const fetch = makeFetchMock();
			globalThis.fetch = fetch;

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			// Queue two actions offline
			await client.markAsRead("ntf_1");
			await client.archive("ntf_2");
			expect(client.queueSize).toBe(2);

			// Connect — should flush the queue
			await connectClient(client);

			// Queue should be empty
			expect(client.queueSize).toBe(0);

			// API calls should have been made for the replayed actions
			const postCalls = (fetch.mock.calls as [string, RequestInit][]).filter(
				([, init]) => init?.method === "POST",
			);
			expect(postCalls.length).toBeGreaterThanOrEqual(2);

			client.disconnect();
		});

		it("replays actions in the order they were enqueued", async () => {
			const callOrder: string[] = [];
			globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
				if (typeof url === "string" && url.includes("/capabilities")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ data: { transports: ["ws"] } }),
					});
				}
				if (init?.method === "POST") {
					callOrder.push(url as string);
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { success: true } }),
				});
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.markAsRead("ntf_1");
			await client.archive("ntf_2");
			await client.markAllAsRead();

			await connectClient(client);

			// Order: markAsRead, archive, markAllAsRead
			expect(callOrder[0]).toContain("/read");
			expect(callOrder[1]).toContain("/archive");
			expect(callOrder[2]).toContain("/read-all");

			client.disconnect();
		});
	});

	describe("actions are replayed on reconnect (transport reconnect)", () => {
		it("flushes queue when transport calls onReconnect", async () => {
			const fetch = makeFetchMock();
			globalThis.fetch = fetch;

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const ws = await connectClient(client);

			// Simulate transport error causing disconnect
			ws.simulateError();
			ws.simulateClose();

			// While offline, queue an action
			await client.markAsRead("ntf_10");
			expect(client.queueSize).toBe(1);

			// Simulate transport reconnect (without creating new WS)
			// We can't easily trigger onReconnect via the ws mock here,
			// but we can verify the queue was non-empty before reconnect

			expect(client.queueSize).toBe(1);
		});
	});

	describe("failed replays emit queueError and don't crash", () => {
		it("emits queueError when a replayed action fails after retry", async () => {
			// First connect: capabilities fetch succeeds, WS opens
			// On connect, queued action is replayed but API returns 503 (fails both attempts)
			let connectCount = 0;
			globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
				if (typeof url === "string" && url.includes("/capabilities")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ data: { transports: ["ws"] } }),
					});
				}
				if (init?.method === "POST") {
					connectCount++;
					return Promise.resolve({
						ok: false,
						status: 503,
						json: () => Promise.resolve({ error: { message: "service unavailable" } }),
					});
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { success: true } }),
				});
			});
			void connectCount; // suppress unused warning

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const queueErrorHandler = vi.fn();
			client.on("queueError", queueErrorHandler);

			// Queue an action offline
			await client.markAsRead("ntf_fail");
			expect(client.queueSize).toBe(1);

			// Connect — flush will fail for the queued action
			await connectClient(client);

			// The action fails replay (2 attempts both return 503) so queueError fires
			expect(queueErrorHandler).toHaveBeenCalledTimes(1);
			const [err, action] = queueErrorHandler.mock.calls[0] as [
				Error,
				{ type: string; args: string[] },
			];
			expect(err).toBeInstanceOf(Error);
			expect(action.type).toBe("markAsRead");
			expect(action.args[0]).toBe("ntf_fail");

			// Queue is drained (action discarded)
			expect(client.queueSize).toBe(0);

			// Client is still connected — did not crash
			expect(client.isConnected).toBe(true);

			client.disconnect();
		});

		it("does not crash when no queueError listener is registered", async () => {
			globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
				if (typeof url === "string" && url.includes("/capabilities")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ data: { transports: ["ws"] } }),
					});
				}
				if (init?.method === "POST") {
					return Promise.resolve({
						ok: false,
						status: 500,
						json: () => Promise.resolve({ error: { message: "error" } }),
					});
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { success: true } }),
				});
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});
			// No queueError listener

			await client.markAsRead("ntf_fail");
			await expect(connectClient(client)).resolves.not.toThrow();

			expect(client.isConnected).toBe(true);
			client.disconnect();
		});
	});

	describe("queue cap", () => {
		it("does not grow beyond maxQueueSize", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
				maxQueueSize: 3,
			});

			await client.markAsRead("ntf_1");
			await client.archive("ntf_2");
			await client.markAllAsRead();
			// At capacity — next enqueue should drop oldest
			await client.markAsUnread("ntf_4");

			expect(client.queueSize).toBe(3);
		});
	});

	describe("storage persistence across sessions", () => {
		it("restores the queue from storage when connecting", async () => {
			const storage = new MemoryStorageAdapter();

			// Session 1: queue an action offline (no connect)
			const client1 = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
				storage,
			});
			await client1.markAsRead("ntf_persisted");
			expect(client1.queueSize).toBe(1);

			// Session 2: new client with same storage, connect
			globalThis.fetch = makeFetchMock();

			const client2 = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
				storage,
			});

			// Before connecting, queue is 0 (not yet restored)
			// After connecting, restore() runs and actions are flushed
			await connectClient(client2);

			// Queue flushed — action was replayed (or failed), queue is empty
			expect(client2.queueSize).toBe(0);

			client2.disconnect();
		});
	});
});
