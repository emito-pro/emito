import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

	simulateError(): void {
		this.onerror?.(new Event("error"));
	}

	simulateClose(): void {
		this.readyState = 3;
		this.onclose?.({ type: "close" } as CloseEvent);
	}
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
});

describe("EmitoClient", () => {
	describe("explicit transport", () => {
		it("connects via ws when transport='ws'", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const connectedHandler = vi.fn();
			client.on("connected", connectedHandler);

			const connectPromise = client.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			expect(client.isConnected).toBe(true);
			expect(client.activeTransport).toBe("ws");
			expect(connectedHandler).toHaveBeenCalled();

			client.disconnect();
		});

		it("emits notification events", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const notificationHandler = vi.fn();
			client.on("notification", notificationHandler);

			const connectPromise = client.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			ws.simulateMessage({
				type: "notification",
				id: "100-0",
				data: {
					notificationId: "ntf_1",
					subscriberId: "sub_1",
					event: "order.filled",
					body: "Order filled for $50",
					data: { amount: 50 },
					timestamp: "2026-04-01T00:00:00.000Z",
				},
			});

			expect(notificationHandler).toHaveBeenCalledWith(
				expect.objectContaining({
					notificationId: "ntf_1",
					event: "order.filled",
				}),
				"100-0",
			);

			client.disconnect();
		});

		it("emits disconnected on transport close", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const disconnectedHandler = vi.fn();
			client.on("disconnected", disconnectedHandler);

			const connectPromise = client.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			client.disconnect();
			expect(disconnectedHandler).toHaveBeenCalled();
			expect(client.isConnected).toBe(false);
			expect(client.activeTransport).toBeNull();
		});

		it("connect() is idempotent", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const connectPromise = client.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			await client.connect();
			expect(MockWebSocket.instances.length).toBe(1);

			client.disconnect();
		});

		it("disconnect() during an in-flight connect() clears the connecting guard so reconnect works", async () => {
			// Reproduces the React StrictMode double-invoke: an effect starts
			// connect() (connecting=true, awaiting the socket open), the cleanup
			// tears it down with disconnect() before it resolves, then the effect
			// re-runs connect(). If disconnect() leaves `connecting` set, the second
			// connect() short-circuits and the client never connects.
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			// First connect: in-flight (socket not opened yet).
			void client.connect();
			// StrictMode-style teardown before the socket opens.
			client.disconnect();
			expect(client.isConnected).toBe(false);

			// Reconnect must succeed.
			const p2 = client.connect();
			MockWebSocket.instances.at(-1)!.simulateOpen();
			await p2;

			expect(client.isConnected).toBe(true);

			client.disconnect();
		});

		it("disconnect() is safe to call when not connected", () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			// Should not throw
			client.disconnect();
		});
	});

	describe("auto transport", () => {
		it("probes capabilities and selects ws when available", async () => {
			// Mock capabilities endpoint
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws", "sse", "polling"] } }),
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				// transport defaults to "auto"
			});

			const connectPromise = client.connect();

			// Wait for capabilities fetch + WS creation
			await vi.advanceTimersByTimeAsync(10);
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			expect(client.isConnected).toBe(true);
			expect(client.activeTransport).toBe("ws");

			client.disconnect();
		});

		it("falls back to polling when ws and sse fail", async () => {
			let fetchCallCount = 0;
			globalThis.fetch = vi.fn().mockImplementation((url: string) => {
				fetchCallCount++;
				if (typeof url === "string" && url.endsWith("/capabilities")) {
					return Promise.resolve({
						ok: true,
						json: () =>
							Promise.resolve({
								data: { transports: ["ws", "sse", "polling"] },
							}),
					});
				}
				if (typeof url === "string" && url.includes("/stream")) {
					return Promise.resolve({ ok: false, status: 503 });
				}
				if (typeof url === "string" && url.includes("/poll")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ data: { items: [], hasMore: false } }),
					});
				}
				return Promise.resolve({ ok: false, status: 404 });
			});

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = client.connect();

			// Wait for capabilities fetch (microtasks) then WS creation
			await vi.advanceTimersByTimeAsync(0);
			const ws = MockWebSocket.instances[0];

			if (ws) {
				// WS will be tried first — simulate failure
				ws.simulateError();
				ws.simulateClose();
			}

			// SSE will be tried next — mock already returns 503
			// Polling will be tried last — mock returns success
			await connectPromise;

			expect(client.isConnected).toBe(true);
			expect(client.activeTransport).toBe("polling");

			client.disconnect();
		});
	});

	describe("event emitter", () => {
		it("supports removing listeners", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const handler = vi.fn();
			client.on("connected", handler);
			client.off("connected", handler);

			const connectPromise = client.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			expect(handler).not.toHaveBeenCalled();
			client.disconnect();
		});
	});

	describe("API versioning", () => {
		it("appends the version to the configured mount endpoint for transports", async () => {
			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			const connectPromise = client.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			expect(ws.url).toContain("/emito/v1/ws");
			client.disconnect();
		});

		it("appends the version for REST calls", async () => {
			const fetchMock = vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ data: { items: [], hasMore: false } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.notifications.list();

			expect(String(fetchMock.mock.calls[0]![0])).toContain(
				"https://myapp.com/emito/v1/notifications",
			);
		});

		it("tolerates a trailing slash on the endpoint without doubling the separator", async () => {
			const fetchMock = vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ data: { items: [], hasMore: false } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const client = new EmitoClient({
				endpoint: "https://myapp.com/emito/",
				subscriberId: "user_1",
				token: "tok",
				transport: "ws",
			});

			await client.notifications.list();

			expect(String(fetchMock.mock.calls[0]![0])).toContain(
				"https://myapp.com/emito/v1/notifications",
			);
		});
	});
});
