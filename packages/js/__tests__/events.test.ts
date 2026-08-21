import { describe, expect, it, vi } from "vitest";
import { TypedEmitter } from "../src/events.js";

type TestEvents = {
	foo: [value: string];
	bar: [a: number, b: boolean];
	empty: [];
};

class TestEmitter extends TypedEmitter<TestEvents> {
	// Expose emit for testing
	public doEmit<K extends keyof TestEvents>(event: K, ...args: TestEvents[K]): void {
		this.emit(event, ...args);
	}
}

describe("TypedEmitter", () => {
	it("calls listeners with correct arguments", () => {
		const emitter = new TestEmitter();
		const handler = vi.fn();
		emitter.on("foo", handler);
		emitter.doEmit("foo", "hello");
		expect(handler).toHaveBeenCalledWith("hello");
	});

	it("supports multiple listeners for the same event", () => {
		const emitter = new TestEmitter();
		const h1 = vi.fn();
		const h2 = vi.fn();
		emitter.on("foo", h1);
		emitter.on("foo", h2);
		emitter.doEmit("foo", "test");
		expect(h1).toHaveBeenCalledWith("test");
		expect(h2).toHaveBeenCalledWith("test");
	});

	it("supports multi-arg events", () => {
		const emitter = new TestEmitter();
		const handler = vi.fn();
		emitter.on("bar", handler);
		emitter.doEmit("bar", 42, true);
		expect(handler).toHaveBeenCalledWith(42, true);
	});

	it("supports zero-arg events", () => {
		const emitter = new TestEmitter();
		const handler = vi.fn();
		emitter.on("empty", handler);
		emitter.doEmit("empty");
		expect(handler).toHaveBeenCalledWith();
	});

	it("removes a specific listener with off()", () => {
		const emitter = new TestEmitter();
		const handler = vi.fn();
		emitter.on("foo", handler);
		emitter.off("foo", handler);
		emitter.doEmit("foo", "nope");
		expect(handler).not.toHaveBeenCalled();
	});

	it("does not remove other listeners on off()", () => {
		const emitter = new TestEmitter();
		const h1 = vi.fn();
		const h2 = vi.fn();
		emitter.on("foo", h1);
		emitter.on("foo", h2);
		emitter.off("foo", h1);
		emitter.doEmit("foo", "test");
		expect(h1).not.toHaveBeenCalled();
		expect(h2).toHaveBeenCalledWith("test");
	});

	it("removeAllListeners() clears all listeners for an event", () => {
		const emitter = new TestEmitter();
		const h1 = vi.fn();
		const h2 = vi.fn();
		emitter.on("foo", h1);
		emitter.on("foo", h2);
		emitter.removeAllListeners("foo");
		emitter.doEmit("foo", "nope");
		expect(h1).not.toHaveBeenCalled();
		expect(h2).not.toHaveBeenCalled();
	});

	it("removeAllListeners() with no arg clears everything", () => {
		const emitter = new TestEmitter();
		const fooHandler = vi.fn();
		const barHandler = vi.fn();
		emitter.on("foo", fooHandler);
		emitter.on("bar", barHandler);
		emitter.removeAllListeners();
		emitter.doEmit("foo", "nope");
		emitter.doEmit("bar", 1, false);
		expect(fooHandler).not.toHaveBeenCalled();
		expect(barHandler).not.toHaveBeenCalled();
	});

	it("listenerCount returns correct count", () => {
		const emitter = new TestEmitter();
		expect(emitter.listenerCount("foo")).toBe(0);
		const h1 = vi.fn();
		const h2 = vi.fn();
		emitter.on("foo", h1);
		expect(emitter.listenerCount("foo")).toBe(1);
		emitter.on("foo", h2);
		expect(emitter.listenerCount("foo")).toBe(2);
		emitter.off("foo", h1);
		expect(emitter.listenerCount("foo")).toBe(1);
	});

	it("does not crash when listener throws", () => {
		const emitter = new TestEmitter();
		const thrower = () => {
			throw new Error("boom");
		};
		const survivor = vi.fn();
		emitter.on("foo", thrower);
		emitter.on("foo", survivor);
		emitter.doEmit("foo", "test");
		expect(survivor).toHaveBeenCalledWith("test");
	});

	it("emitting an event with no listeners is a no-op", () => {
		const emitter = new TestEmitter();
		// Should not throw
		emitter.doEmit("foo", "test");
	});

	it("returns this from on/off/removeAllListeners for chaining", () => {
		const emitter = new TestEmitter();
		const handler = vi.fn();
		const result = emitter.on("foo", handler).off("foo", handler).removeAllListeners();
		expect(result).toBe(emitter);
	});
});
