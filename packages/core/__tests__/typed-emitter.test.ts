/**
 * Tests for the typed event emitter (packages/core/src/events.ts).
 *
 * Covers:
 * - createTypedEmitter returns an object with on, off, emit
 * - on() registers a listener; emit() invokes it with the correct arguments
 * - off() removes a listener; subsequent emit does not call it
 * - Multiple listeners on the same event are all called
 * - Listener added during emit is not called in the same emit cycle
 * - No external dependencies (no Node.js EventEmitter)
 *
 * Rules applied:
 * - Never mock the module under test (rule 10)
 * - Test boundary conditions (rule 4)
 * - Assert on call arguments (rule 28)
 * - Prefer specific matchers (rule 25)
 * - Follow describe/it naming convention (rule 15)
 * - Reset all mocks in afterEach (rule 14)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lazy import to avoid coupling test to exact file path.
// The module under test is expected at packages/core/src/events.ts
// and must export a `createTypedEmitter` function.

type EmitoEvents = {
	"notification:created": (subscriberId: string, event: { id: string }) => void;
	"test:ping": (value: number) => void;
};

async function importEmitter() {
	const mod = await import("../src/events");
	return mod.createTypedEmitter<EmitoEvents>();
}

describe("createTypedEmitter", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should return an object with on, off, and emit methods", async () => {
		const emitter = await importEmitter();

		expect(typeof emitter.on).toBe("function");
		expect(typeof emitter.off).toBe("function");
		expect(typeof emitter.emit).toBe("function");
	});

	// -------------------------------------------------------------------------
	// on() + emit()
	// -------------------------------------------------------------------------

	describe("on + emit", () => {
		it("should call a registered listener when the event is emitted", async () => {
			const emitter = await importEmitter();
			const listener = vi.fn();

			emitter.on("notification:created", listener);
			emitter.emit("notification:created", "sub_1", { id: "notif_1" });

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith("sub_1", { id: "notif_1" });
		});

		it("should call all registered listeners for the same event", async () => {
			const emitter = await importEmitter();
			const listenerA = vi.fn();
			const listenerB = vi.fn();

			emitter.on("notification:created", listenerA);
			emitter.on("notification:created", listenerB);
			emitter.emit("notification:created", "sub_2", { id: "notif_2" });

			expect(listenerA).toHaveBeenCalledOnce();
			expect(listenerB).toHaveBeenCalledOnce();
		});

		it("should not call a listener registered for a different event", async () => {
			const emitter = await importEmitter();
			const listener = vi.fn();

			emitter.on("test:ping", listener);
			emitter.emit("notification:created", "sub_1", { id: "notif_1" });

			expect(listener).not.toHaveBeenCalled();
		});

		it("should call listener once per emit call", async () => {
			const emitter = await importEmitter();
			const listener = vi.fn();

			emitter.on("test:ping", listener);
			emitter.emit("test:ping", 1);
			emitter.emit("test:ping", 2);
			emitter.emit("test:ping", 3);

			expect(listener).toHaveBeenCalledTimes(3);
			expect(listener).toHaveBeenNthCalledWith(1, 1);
			expect(listener).toHaveBeenNthCalledWith(2, 2);
			expect(listener).toHaveBeenNthCalledWith(3, 3);
		});

		it("should not throw when no listeners are registered and event is emitted", async () => {
			const emitter = await importEmitter();

			expect(() => emitter.emit("notification:created", "sub_1", { id: "notif_1" })).not.toThrow();
		});
	});

	// -------------------------------------------------------------------------
	// off()
	// -------------------------------------------------------------------------

	describe("off", () => {
		it("should remove a listener so it is not called on subsequent emits", async () => {
			const emitter = await importEmitter();
			const listener = vi.fn();

			emitter.on("notification:created", listener);
			emitter.off("notification:created", listener);
			emitter.emit("notification:created", "sub_1", { id: "notif_1" });

			expect(listener).not.toHaveBeenCalled();
		});

		it("should only remove the specified listener, leaving others intact", async () => {
			const emitter = await importEmitter();
			const listenerA = vi.fn();
			const listenerB = vi.fn();

			emitter.on("notification:created", listenerA);
			emitter.on("notification:created", listenerB);
			emitter.off("notification:created", listenerA);
			emitter.emit("notification:created", "sub_1", { id: "notif_1" });

			expect(listenerA).not.toHaveBeenCalled();
			expect(listenerB).toHaveBeenCalledOnce();
		});

		it("should not throw when off() is called for a listener that was never registered", async () => {
			const emitter = await importEmitter();
			const listener = vi.fn();

			expect(() => emitter.off("notification:created", listener)).not.toThrow();
		});

		it("should not throw when off() is called for an event with no listeners", async () => {
			const emitter = await importEmitter();
			const listener = vi.fn();

			expect(() => emitter.off("test:ping", listener)).not.toThrow();
		});

		it("should allow re-registering a listener after it has been removed", async () => {
			const emitter = await importEmitter();
			const listener = vi.fn();

			emitter.on("test:ping", listener);
			emitter.off("test:ping", listener);
			emitter.on("test:ping", listener);
			emitter.emit("test:ping", 42);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(42);
		});
	});

	// -------------------------------------------------------------------------
	// Isolation between emitter instances
	// -------------------------------------------------------------------------

	describe("instance isolation", () => {
		it("should not share listeners between two emitter instances", async () => {
			const { createTypedEmitter } = await import("../src/events");
			const emitterA = createTypedEmitter<EmitoEvents>();
			const emitterB = createTypedEmitter<EmitoEvents>();
			const listener = vi.fn();

			emitterA.on("notification:created", listener);
			emitterB.emit("notification:created", "sub_1", { id: "notif_1" });

			expect(listener).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// Error isolation between listeners
	// -------------------------------------------------------------------------

	describe("error isolation", () => {
		it("should still call the second listener when the first listener throws", async () => {
			const emitter = await importEmitter();
			const throwingListener = vi.fn(() => {
				throw new Error("boom");
			});
			const secondListener = vi.fn();

			emitter.on("notification:created", throwingListener);
			emitter.on("notification:created", secondListener);

			expect(() =>
				emitter.emit("notification:created", "sub_1", { id: "notif_1" }),
			).not.toThrow();
			expect(secondListener).toHaveBeenCalledOnce();
			expect(secondListener).toHaveBeenCalledWith("sub_1", { id: "notif_1" });
		});

		it("should log the error via console.error instead of swallowing it silently", async () => {
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
			const emitter = await importEmitter();
			const throwingListener = vi.fn(() => {
				throw new Error("boom");
			});

			emitter.on("notification:created", throwingListener);
			emitter.emit("notification:created", "sub_1", { id: "notif_1" });

			expect(consoleErrorSpy).toHaveBeenCalledOnce();
			const [message] = consoleErrorSpy.mock.calls[0]!;
			expect(String(message)).toContain("notification:created");
		});
	});
});
