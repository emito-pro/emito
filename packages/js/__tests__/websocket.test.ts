import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketAdapter } from "../src/transport/websocket.js";

interface MockWebSocketOptions {
	headers?: Record<string, string>;
}

// Mock WebSocket — captures both url and constructor options (headers for Node mode)
class MockWebSocket {
	static instances: MockWebSocket[] = [];
	readyState = 0; // CONNECTING
	onopen: ((ev: Event) => void) | null = null;
	onmessage: ((ev: MessageEvent) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;
	onclose: ((ev: CloseEvent) => void) | null = null;
	url: string;
	options: MockWebSocketOptions | undefined;

	constructor(url: string, options?: MockWebSocketOptions) {
		this.url = url;
		this.options = options;
		MockWebSocket.instances.push(this);
	}

	close(): void {
		this.readyState = 3; // CLOSED
	}

	// Test helpers
	simulateOpen(): void {
		this.readyState = 1; // OPEN
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

// Replace global WebSocket
const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
	MockWebSocket.instances = [];
	vi.useFakeTimers();
	globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
	// Default: non-browser environment so auto-detect picks header mode
	vi.stubGlobal("window", undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	globalThis.WebSocket = OriginalWebSocket;
});

describe("WebSocketAdapter", () => {
	describe("URL construction", () => {
		it("should not include token in the WebSocket URL", () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "jwt_123",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			expect(ws.url).not.toContain("token=");
			expect(ws.url).not.toContain("jwt_123");
			ws.simulateOpen();
			return connectPromise;
		});

		it("should include lastEventId in URL when provided", () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "jwt_123",
				lastEventId: "1234-0",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			expect(ws.url).toContain("lastEventId=1234-0");
			expect(ws.url).not.toContain("token=");
			ws.simulateOpen();
			return connectPromise;
		});

		it("should omit lastEventId from URL when not provided", () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			expect(ws.url).not.toContain("lastEventId");
			ws.simulateOpen();
			return connectPromise;
		});

		it("should convert http to ws in URL", () => {
			const adapter = new WebSocketAdapter({
				endpoint: "http://localhost:3000/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			expect(ws.url).toMatch(/^ws:\/\//);
			ws.simulateOpen();
			return connectPromise;
		});

		it("should convert https to wss in URL", () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			expect(ws.url).toMatch(/^wss:\/\//);
			ws.simulateOpen();
			return connectPromise;
		});
	});

	describe("auth — browser mode (cookie)", () => {
		beforeEach(() => {
			// Simulate browser environment
			vi.stubGlobal("window", {});
		});

		it("should create WebSocket without auth params in browser auto-detect mode", () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "jwt_browser",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			// No token in URL
			expect(ws.url).not.toContain("token=");
			expect(ws.url).not.toContain("jwt_browser");
			// No Authorization header passed
			expect(ws.options?.headers?.["Authorization"]).toBeUndefined();
			ws.simulateOpen();
			return connectPromise;
		});

		it("should create WebSocket without auth params when wsAuth is 'cookie'", () => {
			// Non-browser environment, but explicit override to cookie
			vi.stubGlobal("window", undefined);

			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "jwt_override",
				wsAuth: "cookie",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			expect(ws.url).not.toContain("token=");
			expect(ws.url).not.toContain("jwt_override");
			expect(ws.options?.headers?.["Authorization"]).toBeUndefined();
			ws.simulateOpen();
			return connectPromise;
		});
	});

	describe("auth — Node/RN mode (Authorization header)", () => {
		it("should pass Authorization header in non-browser auto-detect mode", () => {
			// window is undefined (set in outer beforeEach)
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "jwt_node",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			// Token not in URL
			expect(ws.url).not.toContain("token=");
			expect(ws.url).not.toContain("jwt_node");
			// Authorization header passed to constructor
			expect(ws.options?.headers?.["Authorization"]).toBe("Bearer jwt_node");
			ws.simulateOpen();
			return connectPromise;
		});

		it("should pass Authorization header when wsAuth is 'header' in browser environment", () => {
			// Even in browser, explicit header override should pass the header
			vi.stubGlobal("window", {});

			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "jwt_header_override",
				wsAuth: "header",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			expect(ws.url).not.toContain("token=");
			expect(ws.options?.headers?.["Authorization"]).toBe("Bearer jwt_header_override");
			ws.simulateOpen();
			return connectPromise;
		});

		it("uses getToken for the Authorization header in header mode", async () => {
			// window is undefined (set in outer beforeEach) -> auto-detect picks header mode
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				getToken: async () => "jwt_from_getToken",
			});

			const connectPromise = adapter.connect();
			// getToken resolution happens via a microtask before the socket is constructed
			await Promise.resolve();
			await Promise.resolve();
			const ws = MockWebSocket.instances[0]!;
			expect(ws.options?.headers?.["Authorization"]).toBe("Bearer jwt_from_getToken");
			ws.simulateOpen();
			await connectPromise;
		});
	});

	describe("auto-detect", () => {
		it("should use cookie mode when window is defined (browser)", () => {
			vi.stubGlobal("window", {});

			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			// Browser: no Authorization header
			expect(ws.options?.headers?.["Authorization"]).toBeUndefined();
			ws.simulateOpen();
			return connectPromise;
		});

		it("should use header mode when window is undefined (Node/RN)", () => {
			// window is undefined (set in outer beforeEach)
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			// Node: Authorization header present
			expect(ws.options?.headers?.["Authorization"]).toBe("Bearer tok");
			ws.simulateOpen();
			return connectPromise;
		});
	});

	describe("connection lifecycle", () => {
		it("should resolve connect() on successful open", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;
			expect(adapter.state).toBe("connected");
		});

		it("should reject connect() on error before open", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateError();
			await expect(connectPromise).rejects.toThrow("WebSocket connection error");
			expect(adapter.state).toBe("disconnected");
		});

		it("should reject connect() on close before open", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateClose();
			await expect(connectPromise).rejects.toThrow("WebSocket closed before open");
		});

		it("should set state to disconnected on disconnect() and prevent reconnect", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			adapter.disconnect();
			expect(adapter.state).toBe("disconnected");
		});

		it("should be idempotent when connect() is called while already connected", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			// Second call should resolve immediately without creating a new socket
			await adapter.connect();
			expect(MockWebSocket.instances.length).toBe(1);
		});
	});

	describe("message handling", () => {
		it("should deliver notification messages via onMessage handler", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const messageHandler = vi.fn();
			adapter.onMessage(messageHandler);

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			ws.simulateMessage({
				type: "notification",
				id: "123-0",
				data: {
					notificationId: "ntf_1",
					subscriberId: "sub_1",
					event: "order.filled",
					body: "Order filled for $100",
					data: { amount: 100 },
					timestamp: "2026-04-01T00:00:00.000Z",
				},
			});

			expect(messageHandler).toHaveBeenCalledWith(
				expect.objectContaining({
					notificationId: "ntf_1",
					event: "order.filled",
					timestamp: expect.any(Date),
				}),
				"123-0",
			);
		});

		it("should ignore heartbeat and non-notification messages", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const messageHandler = vi.fn();
			adapter.onMessage(messageHandler);

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			ws.simulateMessage({ type: "heartbeat" });
			ws.simulateMessage({ type: "unknown" });
			expect(messageHandler).not.toHaveBeenCalled();
		});

		it("should ignore malformed JSON messages", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const messageHandler = vi.fn();
			adapter.onMessage(messageHandler);

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			// Send raw non-JSON string
			ws.onmessage?.(new MessageEvent("message", { data: "not json" }));
			expect(messageHandler).not.toHaveBeenCalled();
		});
	});

	describe("heartbeat", () => {
		it("should trigger heartbeat timeout when no messages received", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				heartbeatTimeoutMs: 5000,
			});

			const errorHandler = vi.fn();
			adapter.onError(errorHandler);

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			// Advance past heartbeat timeout
			vi.advanceTimersByTime(5001);
			expect(errorHandler).toHaveBeenCalledWith(
				expect.objectContaining({ message: "WebSocket heartbeat timeout" }),
			);
		});

		it("should reset heartbeat timer on incoming message", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
				heartbeatTimeoutMs: 5000,
			});

			const errorHandler = vi.fn();
			adapter.onError(errorHandler);

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			// Advance 4 seconds (just under timeout)
			vi.advanceTimersByTime(4000);
			// Receive a heartbeat — resets timer
			ws.simulateMessage({ type: "heartbeat" });
			// Advance another 4 seconds
			vi.advanceTimersByTime(4000);
			// Should NOT have timed out (only 4s since last message)
			expect(errorHandler).not.toHaveBeenCalled();
		});
	});

	describe("reconnect", () => {
		it("should schedule reconnect on unexpected close", async () => {
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const reconnectHandler = vi.fn();
			adapter.onReconnect(reconnectHandler);

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			// Simulate unexpected close
			ws.simulateClose();
			expect(adapter.state).toBe("disconnected");

			// Advance timers to trigger reconnect
			vi.advanceTimersByTime(2000);
			// A new WebSocket instance should be created
			expect(MockWebSocket.instances.length).toBe(2);

			// Simulate successful reconnect
			const ws2 = MockWebSocket.instances[1]!;
			ws2.simulateOpen();

			// Wait for the promise to resolve
			await vi.runAllTimersAsync();
			expect(reconnectHandler).toHaveBeenCalled();
		});

		it("should use the same auth mode on reconnect as the initial connection", async () => {
			// Node mode: Authorization header
			const adapter = new WebSocketAdapter({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const connectPromise = adapter.connect();
			const ws = MockWebSocket.instances[0]!;
			ws.simulateOpen();
			await connectPromise;

			// Unexpected close triggers reconnect
			ws.simulateClose();
			vi.advanceTimersByTime(2000);

			// New socket should also have Authorization header
			const ws2 = MockWebSocket.instances[1]!;
			expect(ws2.options?.headers?.["Authorization"]).toBe("Bearer tok");
			ws2.simulateOpen();
			await vi.runAllTimersAsync();
		});
	});
});
