import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSEAdapter } from "../src/transport/sse.js";

// Helper to create a controllable ReadableStream
function createMockStream(): {
	stream: ReadableStream<Uint8Array>;
	push: (data: string) => void;
	close: () => void;
} {
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array>;

	const stream = new ReadableStream<Uint8Array>({
		start(ctrl) {
			controller = ctrl;
		},
	});

	return {
		stream,
		push(data: string) {
			controller.enqueue(encoder.encode(data));
		},
		close() {
			controller.close();
		},
	};
}

// Store original fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	globalThis.fetch = originalFetch;
});

describe("SSEAdapter", () => {
	it("connects with correct URL and headers", async () => {
		const mockStream = createMockStream();
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			body: mockStream.stream,
		});
		globalThis.fetch = fetchSpy;

		const adapter = new SSEAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "jwt_123",
			lastEventId: "100-0",
		});

		const connectPromise = adapter.connect();
		await connectPromise;

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://myapp.com/emito/stream",
			expect.objectContaining({
				headers: {
					Authorization: "Bearer jwt_123",
					Accept: "text/event-stream",
					"Last-Event-ID": "100-0",
				},
			}),
		);
		expect(adapter.state).toBe("connected");

		adapter.disconnect();
	});

	it("uses getToken for the Authorization header on connect", async () => {
		const mockStream = createMockStream();
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			body: mockStream.stream,
		});
		globalThis.fetch = fetchSpy;

		const adapter = new SSEAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			getToken: async () => "jwt_dynamic",
		});

		await adapter.connect();

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://myapp.com/emito/stream",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer jwt_dynamic",
				}),
			}),
		);

		adapter.disconnect();
	});

	it("rejects on non-OK response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

		const adapter = new SSEAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "bad_token",
		});

		await expect(adapter.connect()).rejects.toThrow("SSE connection failed: 401");
		expect(adapter.state).toBe("disconnected");
	});

	it("rejects when response has no body", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body: null });

		const adapter = new SSEAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		await expect(adapter.connect()).rejects.toThrow("SSE response has no body");
	});

	it("parses SSE notification events", async () => {
		const mockStream = createMockStream();
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: mockStream.stream,
		});

		const adapter = new SSEAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		const messageHandler = vi.fn();
		adapter.onMessage(messageHandler);

		await adapter.connect();

		const event = {
			notificationId: "ntf_1",
			subscriberId: "sub_1",
			event: "order.filled",
			body: "Order filled for $100",
			data: { amount: 100 },
			timestamp: "2026-04-01T00:00:00.000Z",
		};

		mockStream.push(`event: notification\nid: 200-0\ndata: ${JSON.stringify(event)}\n\n`);

		// Give the stream reader time to process
		await vi.advanceTimersByTimeAsync(10);

		expect(messageHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				notificationId: "ntf_1",
				timestamp: expect.any(Date),
			}),
			"200-0",
		);

		adapter.disconnect();
	});

	it("ignores heartbeat events", async () => {
		const mockStream = createMockStream();
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: mockStream.stream,
		});

		const adapter = new SSEAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		const messageHandler = vi.fn();
		adapter.onMessage(messageHandler);

		await adapter.connect();

		mockStream.push("event: heartbeat\ndata: {}\n\n");
		await vi.advanceTimersByTimeAsync(10);

		expect(messageHandler).not.toHaveBeenCalled();

		adapter.disconnect();
	});

	it("disconnect() sets state to disconnected", async () => {
		const mockStream = createMockStream();
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: mockStream.stream,
		});

		const adapter = new SSEAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		await adapter.connect();
		adapter.disconnect();
		expect(adapter.state).toBe("disconnected");
	});

	it("connect() is idempotent when already connected", async () => {
		const mockStream = createMockStream();
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			body: mockStream.stream,
		});
		globalThis.fetch = fetchSpy;

		const adapter = new SSEAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		await adapter.connect();
		await adapter.connect(); // Should be a no-op
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		adapter.disconnect();
	});

	it("handles multiple events in a single chunk", async () => {
		const mockStream = createMockStream();
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: mockStream.stream,
		});

		const adapter = new SSEAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		const messageHandler = vi.fn();
		adapter.onMessage(messageHandler);

		await adapter.connect();

		const event1 = {
			notificationId: "ntf_1",
			subscriberId: "sub_1",
			event: "a",
			body: "Event A",
			timestamp: "2026-04-01T00:00:00.000Z",
		};
		const event2 = {
			notificationId: "ntf_2",
			subscriberId: "sub_1",
			event: "b",
			body: "Event B",
			timestamp: "2026-04-01T00:00:01.000Z",
		};

		mockStream.push(
			`event: notification\nid: 1-0\ndata: ${JSON.stringify(event1)}\n\nevent: notification\nid: 2-0\ndata: ${JSON.stringify(event2)}\n\n`,
		);

		await vi.advanceTimersByTimeAsync(10);

		expect(messageHandler).toHaveBeenCalledTimes(2);
		expect(messageHandler).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ notificationId: "ntf_1" }),
			"1-0",
		);
		expect(messageHandler).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ notificationId: "ntf_2" }),
			"2-0",
		);

		adapter.disconnect();
	});
});
