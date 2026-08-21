import type { NotificationEvent } from "@emito/types";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "../src/useToast.js";

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
};

vi.mock("../src/context.js", () => ({
	useEmitoClient: () => mockClient,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let eventCounter = 0;

function makeNotificationEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
	eventCounter++;
	return {
		notificationId: `ntf_${eventCounter}`,
		subscriberId: "sub_1",
		event: "order.filled",
		body: "Your order has been filled",
		timestamp: new Date("2026-04-01T00:00:00.000Z"),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useToast", () => {
	beforeEach(() => {
		eventCounter = 0;
		listeners.clear();
		vi.clearAllMocks();
		vi.useFakeTimers();
		mockClient.on.mockImplementation(clientOn);
		mockClient.off.mockImplementation(clientOff);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("initial state", () => {
		it("should return an empty toast queue", () => {
			const { result } = renderHook(() => useToast());
			expect(result.current.toasts).toEqual([]);
		});

		it("should return add, dismiss, and clear functions", () => {
			const { result } = renderHook(() => useToast());
			expect(typeof result.current.add).toBe("function");
			expect(typeof result.current.dismiss).toBe("function");
			expect(typeof result.current.clear).toBe("function");
		});
	});

	describe("notification event subscription", () => {
		it("should subscribe to notification events", () => {
			renderHook(() => useToast());
			expect(listeners.has("notification")).toBe(true);
			expect(listeners.get("notification")?.size).toBeGreaterThan(0);
		});

		it("should add a toast when a notification event is received", () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent(
					"notification",
					makeNotificationEvent({
						body: "New order shipped",
						subject: "Order #123",
					}),
				);
			});

			expect(result.current.toasts).toHaveLength(1);
			expect(result.current.toasts[0]!.body).toBe("New order shipped");
			expect(result.current.toasts[0]!.subject).toBe("Order #123");
		});

		it("should map all NotificationEvent fields to ToastItem", () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent(
					"notification",
					makeNotificationEvent({
						body: "Test body",
						subject: "Test subject",
						avatar: "https://example.com/avatar.png",
						actionUrl: "/orders/123",
						primaryAction: { label: "View", url: "/view" },
						secondaryAction: { label: "Dismiss", url: "/dismiss" },
						data: { orderId: "123" },
					}),
				);
			});

			const toast = result.current.toasts[0]!;
			expect(toast.body).toBe("Test body");
			expect(toast.subject).toBe("Test subject");
			expect(toast.avatar).toBe("https://example.com/avatar.png");
			expect(toast.actionUrl).toBe("/orders/123");
			expect(toast.primaryAction).toEqual({ label: "View", url: "/view" });
			expect(toast.secondaryAction).toEqual({ label: "Dismiss", url: "/dismiss" });
			expect(toast.data).toEqual({ orderId: "123" });
		});

		it("should add multiple toasts from multiple events", () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "First" }));
				emitEvent("notification", makeNotificationEvent({ body: "Second" }));
				emitEvent("notification", makeNotificationEvent({ body: "Third" }));
			});

			expect(result.current.toasts).toHaveLength(3);
			expect(result.current.toasts[0]!.body).toBe("First");
			expect(result.current.toasts[1]!.body).toBe("Second");
			expect(result.current.toasts[2]!.body).toBe("Third");
		});
	});

	describe("auto-dismiss", () => {
		it("should auto-dismiss after default duration (5000ms)", async () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Will dismiss" }));
			});

			expect(result.current.toasts).toHaveLength(1);

			await act(async () => {
				await vi.advanceTimersByTimeAsync(5000);
			});

			expect(result.current.toasts).toHaveLength(0);
		});

		it("should auto-dismiss after custom duration", async () => {
			const { result } = renderHook(() => useToast({ duration: 2000 }));

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Quick toast" }));
			});

			expect(result.current.toasts).toHaveLength(1);

			await act(async () => {
				await vi.advanceTimersByTimeAsync(2000);
			});

			expect(result.current.toasts).toHaveLength(0);
		});

		it("should not dismiss before duration elapses", async () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Still here" }));
			});

			await act(async () => {
				await vi.advanceTimersByTimeAsync(4999);
			});

			expect(result.current.toasts).toHaveLength(1);
		});

		it("should dismiss toasts independently based on their arrival time", async () => {
			const { result } = renderHook(() => useToast({ duration: 3000 }));

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "First" }));
			});

			await act(async () => {
				await vi.advanceTimersByTimeAsync(1000);
			});

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Second" }));
			});

			// At t=3000, first should dismiss but second should remain
			await act(async () => {
				await vi.advanceTimersByTimeAsync(2000);
			});

			expect(result.current.toasts).toHaveLength(1);
			expect(result.current.toasts[0]!.body).toBe("Second");

			// At t=4000, second should also dismiss
			await act(async () => {
				await vi.advanceTimersByTimeAsync(1000);
			});

			expect(result.current.toasts).toHaveLength(0);
		});
	});

	describe("dismiss", () => {
		it("should remove a specific toast by id", () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "First" }));
				emitEvent("notification", makeNotificationEvent({ body: "Second" }));
			});

			const firstId = result.current.toasts[0]!.id;

			act(() => {
				result.current.dismiss(firstId);
			});

			expect(result.current.toasts).toHaveLength(1);
			expect(result.current.toasts[0]!.body).toBe("Second");
		});

		it("should clear the auto-dismiss timer when manually dismissed", async () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Dismissed early" }));
			});

			const id = result.current.toasts[0]!.id;

			act(() => {
				result.current.dismiss(id);
			});

			expect(result.current.toasts).toHaveLength(0);

			// Advancing past the original timer should not cause errors
			await act(async () => {
				await vi.advanceTimersByTimeAsync(10000);
			});

			expect(result.current.toasts).toHaveLength(0);
		});

		it("should be a no-op for unknown ids", () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Keep me" }));
			});

			act(() => {
				result.current.dismiss("unknown-id");
			});

			expect(result.current.toasts).toHaveLength(1);
		});
	});

	describe("clear", () => {
		it("should remove all toasts", () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "One" }));
				emitEvent("notification", makeNotificationEvent({ body: "Two" }));
				emitEvent("notification", makeNotificationEvent({ body: "Three" }));
			});

			expect(result.current.toasts).toHaveLength(3);

			act(() => {
				result.current.clear();
			});

			expect(result.current.toasts).toHaveLength(0);
		});

		it("should clear all auto-dismiss timers", async () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "One" }));
				emitEvent("notification", makeNotificationEvent({ body: "Two" }));
			});

			act(() => {
				result.current.clear();
			});

			// Timers should be cleared — no state changes after advancing
			await act(async () => {
				await vi.advanceTimersByTimeAsync(10000);
			});

			expect(result.current.toasts).toHaveLength(0);
		});
	});

	describe("add (manual injection)", () => {
		it("should add a toast manually without a notification event", () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				result.current.add({ body: "Custom toast" });
			});

			expect(result.current.toasts).toHaveLength(1);
			expect(result.current.toasts[0]!.body).toBe("Custom toast");
			expect(result.current.toasts[0]!.id).toBeDefined();
			expect(result.current.toasts[0]!.createdAt).toBeDefined();
		});

		it("should auto-dismiss manually added toasts", async () => {
			const { result } = renderHook(() => useToast({ duration: 3000 }));

			act(() => {
				result.current.add({ body: "Will auto-dismiss" });
			});

			expect(result.current.toasts).toHaveLength(1);

			await act(async () => {
				await vi.advanceTimersByTimeAsync(3000);
			});

			expect(result.current.toasts).toHaveLength(0);
		});

		it("should respect per-toast duration override", async () => {
			const { result } = renderHook(() => useToast({ duration: 5000 }));

			act(() => {
				result.current.add({ body: "Quick one", duration: 1000 });
			});

			await act(async () => {
				await vi.advanceTimersByTimeAsync(1000);
			});

			expect(result.current.toasts).toHaveLength(0);
		});

		it("should accept all optional fields", () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				result.current.add({
					body: "Full toast",
					subject: "Subject",
					avatar: "https://example.com/avatar.png",
					actionUrl: "/action",
					primaryAction: { label: "Go", url: "/go" },
					secondaryAction: { label: "Skip", url: "/skip" },
					data: { key: "value" },
					duration: 8000,
				});
			});

			const toast = result.current.toasts[0]!;
			expect(toast.subject).toBe("Subject");
			expect(toast.avatar).toBe("https://example.com/avatar.png");
			expect(toast.actionUrl).toBe("/action");
			expect(toast.primaryAction).toEqual({ label: "Go", url: "/go" });
			expect(toast.secondaryAction).toEqual({ label: "Skip", url: "/skip" });
			expect(toast.data).toEqual({ key: "value" });
		});
	});

	describe("max queue size", () => {
		it("should evict oldest toast when max size is exceeded", () => {
			const { result } = renderHook(() => useToast({ maxSize: 2 }));

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "First" }));
			});
			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Second" }));
			});
			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Third" }));
			});

			expect(result.current.toasts).toHaveLength(2);
			expect(result.current.toasts[0]!.body).toBe("Second");
			expect(result.current.toasts[1]!.body).toBe("Third");
		});

		it("should clear timer for evicted toast", async () => {
			const { result } = renderHook(() => useToast({ maxSize: 1, duration: 5000 }));

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "First" }));
			});
			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Second" }));
			});

			expect(result.current.toasts).toHaveLength(1);
			expect(result.current.toasts[0]!.body).toBe("Second");

			// Advance past when First would have auto-dismissed — should not cause issues
			await act(async () => {
				await vi.advanceTimersByTimeAsync(5000);
			});

			// Second should also be dismissed by its own timer
			expect(result.current.toasts).toHaveLength(0);
		});

		it("should default to maxSize of 5", () => {
			const { result } = renderHook(() => useToast());

			act(() => {
				for (let i = 0; i < 7; i++) {
					emitEvent("notification", makeNotificationEvent({ body: `Toast ${i}` }));
				}
			});

			expect(result.current.toasts).toHaveLength(5);
			expect(result.current.toasts[0]!.body).toBe("Toast 2");
			expect(result.current.toasts[4]!.body).toBe("Toast 6");
		});
	});

	describe("cleanup on unmount", () => {
		it("should unsubscribe from notification events on unmount", () => {
			const { unmount } = renderHook(() => useToast());

			expect(listeners.get("notification")?.size).toBeGreaterThan(0);

			unmount();

			expect(listeners.get("notification")?.size ?? 0).toBe(0);
		});

		it("should clear all timers on unmount", async () => {
			const { result, unmount } = renderHook(() => useToast());

			act(() => {
				emitEvent("notification", makeNotificationEvent({ body: "Active" }));
			});

			expect(result.current.toasts).toHaveLength(1);

			unmount();

			// Advancing timers after unmount should not cause errors
			await act(async () => {
				await vi.advanceTimersByTimeAsync(10000);
			});
		});
	});
});
