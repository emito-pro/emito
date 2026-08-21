import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnreadCount } from "../src/useUnreadCount.js";

// ---------------------------------------------------------------------------
// Mock useEmitoClient
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

const listeners = new Map<string, Set<Listener>>();

function clientOn(event: string, listener: Listener) {
	let set = listeners.get(event);
	if (!set) {
		set = new Set();
		listeners.set(event, set);
	}
	set.add(listener);
	return mockClient;
}

function clientOff(event: string, listener: Listener) {
	listeners.get(event)?.delete(listener);
	return mockClient;
}

function emitEvent(event: string, ...args: unknown[]) {
	const set = listeners.get(event);
	if (!set) return;
	for (const fn of set) fn(...args);
}

const mockClient = {
	on: vi.fn(clientOn),
	off: vi.fn(clientOff),
	notifications: {
		unreadCount: vi.fn().mockResolvedValue(0),
	},
};

vi.mock("../src/context.js", () => ({
	useEmitoClient: () => mockClient,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useUnreadCount", () => {
	beforeEach(() => {
		listeners.clear();
		vi.clearAllMocks();
		mockClient.on.mockImplementation(clientOn);
		mockClient.off.mockImplementation(clientOff);
		mockClient.notifications.unreadCount.mockResolvedValue(0);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("initial state", () => {
		it("should return unreadCount=0 initially", () => {
			const { result } = renderHook(() => useUnreadCount());
			expect(result.current.unreadCount).toBe(0);
		});

		it("should seed unread count from server on mount", async () => {
			mockClient.notifications.unreadCount.mockResolvedValue(5);

			const { result } = renderHook(() => useUnreadCount());
			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.unreadCount).toBe(5);
		});
	});

	describe("live updates", () => {
		it("should increment on real-time notification event", async () => {
			mockClient.notifications.unreadCount.mockResolvedValue(3);

			const { result } = renderHook(() => useUnreadCount());
			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.unreadCount).toBe(3);

			act(() => {
				emitEvent("notification", {
					notificationId: "ntf_live",
					subscriberId: "sub_1",
					event: "order.shipped",
					body: "Order shipped",
					timestamp: new Date(),
				});
			});

			expect(result.current.unreadCount).toBe(4);
		});

		it("should increment multiple times for multiple events", async () => {
			mockClient.notifications.unreadCount.mockResolvedValue(0);

			const { result } = renderHook(() => useUnreadCount());
			await act(async () => {
				await Promise.resolve();
			});

			act(() => {
				emitEvent("notification", {
					notificationId: "ntf_1",
					subscriberId: "sub_1",
					event: "a",
					body: "Event A",
					timestamp: new Date(),
				});
				emitEvent("notification", {
					notificationId: "ntf_2",
					subscriberId: "sub_1",
					event: "b",
					body: "Event B",
					timestamp: new Date(),
				});
				emitEvent("notification", {
					notificationId: "ntf_3",
					subscriberId: "sub_1",
					event: "c",
					body: "Event C",
					timestamp: new Date(),
				});
			});

			expect(result.current.unreadCount).toBe(3);
		});
	});

	describe("cleanup", () => {
		it("should unsubscribe from notification event on unmount", async () => {
			const { unmount } = renderHook(() => useUnreadCount());
			await act(async () => {
				await Promise.resolve();
			});

			const listenersBefore = listeners.get("notification")?.size ?? 0;
			expect(listenersBefore).toBeGreaterThan(0);

			unmount();

			const listenersAfter = listeners.get("notification")?.size ?? 0;
			expect(listenersAfter).toBe(0);
		});
	});

	describe("boundary conditions", () => {
		it("should handle count of 0", async () => {
			mockClient.notifications.unreadCount.mockResolvedValue(0);

			const { result } = renderHook(() => useUnreadCount());
			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.unreadCount).toBe(0);
		});

		it("should handle large count values", async () => {
			mockClient.notifications.unreadCount.mockResolvedValue(99999);

			const { result } = renderHook(() => useUnreadCount());
			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.unreadCount).toBe(99999);
		});
	});
});
