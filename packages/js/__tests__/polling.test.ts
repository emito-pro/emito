import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollingAdapter } from "../src/transport/polling.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	globalThis.fetch = originalFetch;
});

function mockFetchResponse(items: unknown[] = [], hasMore = false) {
	return vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve({ data: { items, hasMore } }),
	});
}

describe("PollingAdapter", () => {
	it("connects by performing an initial poll", async () => {
		const fetchSpy = mockFetchResponse();
		globalThis.fetch = fetchSpy;

		const adapter = new PollingAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		await adapter.connect();
		expect(adapter.state).toBe("connected");
		expect(fetchSpy).toHaveBeenCalledWith(
			"https://myapp.com/emito/poll",
			expect.objectContaining({
				headers: { Authorization: "Bearer tok" },
			}),
		);

		adapter.disconnect();
	});

	it("includes since parameter when lastEventId is set", async () => {
		const fetchSpy = mockFetchResponse();
		globalThis.fetch = fetchSpy;

		const adapter = new PollingAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
			lastEventId: "100-0",
		});

		await adapter.connect();
		expect(fetchSpy).toHaveBeenCalledWith(
			"https://myapp.com/emito/poll?since=100-0",
			expect.anything(),
		);

		adapter.disconnect();
	});

	it("rejects connect on failed initial poll", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 503,
		});

		const adapter = new PollingAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		await expect(adapter.connect()).rejects.toThrow("Poll request failed: 503");
		expect(adapter.state).toBe("disconnected");
	});

	it("delivers messages from poll response", async () => {
		const items = [
			{
				id: "1-0",
				event: {
					notificationId: "ntf_1",
					subscriberId: "sub_1",
					event: "test",
					body: "Test notification",
					timestamp: "2026-04-01T00:00:00.000Z",
				},
			},
			{
				id: "2-0",
				event: {
					notificationId: "ntf_2",
					subscriberId: "sub_1",
					event: "test2",
					body: "Test notification 2",
					timestamp: "2026-04-01T00:00:01.000Z",
				},
			},
		];

		globalThis.fetch = mockFetchResponse(items);

		const adapter = new PollingAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		const messageHandler = vi.fn();
		adapter.onMessage(messageHandler);

		await adapter.connect();

		expect(messageHandler).toHaveBeenCalledTimes(2);
		expect(messageHandler).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				notificationId: "ntf_1",
				timestamp: expect.any(Date),
			}),
			"1-0",
		);
		expect(messageHandler).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ notificationId: "ntf_2" }),
			"2-0",
		);

		adapter.disconnect();
	});

	it("polls at the configured interval", async () => {
		const fetchSpy = mockFetchResponse();
		globalThis.fetch = fetchSpy;

		const adapter = new PollingAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
			intervalMs: 5000,
		});

		await adapter.connect();
		expect(fetchSpy).toHaveBeenCalledTimes(1); // initial poll

		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchSpy).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchSpy).toHaveBeenCalledTimes(3);

		adapter.disconnect();
	});

	it("stops polling on disconnect", async () => {
		const fetchSpy = mockFetchResponse();
		globalThis.fetch = fetchSpy;

		const adapter = new PollingAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
			intervalMs: 5000,
		});

		await adapter.connect();
		adapter.disconnect();
		expect(adapter.state).toBe("disconnected");

		fetchSpy.mockClear();
		await vi.advanceTimersByTimeAsync(10000);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("reports errors from failed polls but keeps polling", async () => {
		let callCount = 0;
		globalThis.fetch = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Initial poll succeeds
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: { items: [], hasMore: false } }),
				});
			}
			// Subsequent polls fail
			return Promise.resolve({ ok: false, status: 500 });
		});

		const adapter = new PollingAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
			intervalMs: 5000,
		});

		const errorHandler = vi.fn();
		adapter.onError(errorHandler);

		await adapter.connect();

		await vi.advanceTimersByTimeAsync(5000);
		expect(errorHandler).toHaveBeenCalledWith(
			expect.objectContaining({ message: "Poll request failed: 500" }),
		);
	});

	it("connect() is idempotent when already connected", async () => {
		const fetchSpy = mockFetchResponse();
		globalThis.fetch = fetchSpy;

		const adapter = new PollingAdapter({
			endpoint: "https://myapp.com/emito",
			subscriberId: "user_1",
			token: "tok",
		});

		await adapter.connect();
		await adapter.connect(); // Should be a no-op
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		adapter.disconnect();
	});
});
