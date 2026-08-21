import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransportManager } from "../src/transport/manager.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	globalThis.fetch = originalFetch;
});

describe("TransportManager", () => {
	describe("probeCapabilities", () => {
		it("fetches capabilities from the server", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws", "sse", "polling"] } }),
			});

			const manager = new TransportManager({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			const result = await manager.probeCapabilities();
			expect(result).toEqual(["ws", "sse", "polling"]);
			expect(globalThis.fetch).toHaveBeenCalledWith("https://myapp.com/emito/capabilities");
		});

		it("caches the result on subsequent calls", async () => {
			const fetchSpy = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws", "sse"] } }),
			});
			globalThis.fetch = fetchSpy;

			const manager = new TransportManager({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			await manager.probeCapabilities();
			await manager.probeCapabilities();
			expect(fetchSpy).toHaveBeenCalledTimes(1);
		});

		it("throws on non-OK response", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

			const manager = new TransportManager({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			await expect(manager.probeCapabilities()).rejects.toThrow("Capabilities probe failed: 500");
		});

		it("throws on invalid response shape", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: {} }),
			});

			const manager = new TransportManager({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			await expect(manager.probeCapabilities()).rejects.toThrow("Invalid capabilities response");
		});

		it("clearCache forces re-fetch", async () => {
			const fetchSpy = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["ws"] } }),
			});
			globalThis.fetch = fetchSpy;

			const manager = new TransportManager({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			await manager.probeCapabilities();
			manager.clearCache();
			await manager.probeCapabilities();
			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});
	});

	describe("createAdapter", () => {
		it("creates WebSocket adapter", () => {
			const manager = new TransportManager({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});
			const adapter = manager.createAdapter("ws");
			expect(adapter.type).toBe("ws");
		});

		it("creates SSE adapter", () => {
			const manager = new TransportManager({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});
			const adapter = manager.createAdapter("sse");
			expect(adapter.type).toBe("sse");
		});

		it("creates polling adapter", () => {
			const manager = new TransportManager({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});
			const adapter = manager.createAdapter("polling");
			expect(adapter.type).toBe("polling");
		});
	});

	describe("selectAndConnect", () => {
		it("throws when no compatible transports available", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: { transports: ["grpc"] } }),
			});

			const manager = new TransportManager({
				endpoint: "https://myapp.com/emito",
				subscriberId: "user_1",
				token: "tok",
			});

			await expect(manager.selectAndConnect()).rejects.toThrow(
				"No compatible transports available from server",
			);
		});
	});
});
