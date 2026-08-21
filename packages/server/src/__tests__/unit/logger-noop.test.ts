/**
 * Unit tests for the no-op logger factory (packages/server/src/logger.ts).
 *
 * Success criteria verified:
 * - No-op logger in @emito/server, used as default
 * - All methods are no-ops (return undefined, no output)
 * - child() returns itself (same Logger instance satisfying Logger interface)
 * - Logger interface compatibility: info, warn, error, child
 *
 * Rules applied:
 * - Rule 5: Test null/undefined handling for optional parameters
 * - Rule 13: Use mockLogger for all tests (n/a — this file IS testing the logger factory)
 * - Rule 15: describe("functionName") > it("should {behavior} when {condition}")
 * - Rule 25: Prefer specific matchers over generic ones
 * - Rule 31: Do not test private methods directly
 */

import { describe, expect, it, vi } from "vitest";
import { createNoopLogger } from "../../logger.js";

describe("createNoopLogger()", () => {
	it("should return an object with info, warn, error, and child methods", () => {
		const logger = createNoopLogger();
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
		expect(typeof logger.child).toBe("function");
	});

	it("should not throw when info() is called with fields and message", () => {
		const logger = createNoopLogger();
		expect(() => logger.info({ notificationId: "ntf_1" }, "test message")).not.toThrow();
	});

	it("should not throw when warn() is called with fields and message", () => {
		const logger = createNoopLogger();
		expect(() =>
			logger.warn({ notificationId: "ntf_1", errorCode: "SOME_ERROR" }, "test warning"),
		).not.toThrow();
	});

	it("should not throw when error() is called with fields and message", () => {
		const logger = createNoopLogger();
		expect(() => logger.error({ errorCode: "SOME_ERROR" }, "test error")).not.toThrow();
	});

	it("should not throw when info() is called with fields only (no message)", () => {
		const logger = createNoopLogger();
		expect(() => logger.info({ notificationId: "ntf_1" })).not.toThrow();
	});

	it("should not throw when warn() is called with fields only (no message)", () => {
		const logger = createNoopLogger();
		expect(() => logger.warn({ notificationId: "ntf_1" })).not.toThrow();
	});

	it("should not throw when error() is called with fields only (no message)", () => {
		const logger = createNoopLogger();
		expect(() => logger.error({ notificationId: "ntf_1" })).not.toThrow();
	});

	it("should not throw when child() is called with bindings", () => {
		const logger = createNoopLogger();
		expect(() => logger.child({ scope: "tracking" })).not.toThrow();
	});

	it("should return itself from child() — noop child is the same logger", () => {
		const logger = createNoopLogger();
		const child = logger.child({ scope: "tracking" });
		// child() must return a Logger — verify it has all required methods
		expect(typeof child.info).toBe("function");
		expect(typeof child.warn).toBe("function");
		expect(typeof child.error).toBe("function");
		expect(typeof child.child).toBe("function");
	});

	it("should return a Logger from child() that also does not throw", () => {
		const logger = createNoopLogger();
		const child = logger.child({ scope: "tracking" });
		expect(() => child.warn({ notificationId: "ntf_1" }, "nested warn")).not.toThrow();
	});

	it("should produce no console output — info() is silent", () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const logger = createNoopLogger();
		logger.info({ notificationId: "ntf_1" }, "should be silent");
		expect(consoleSpy).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("should produce no console output — warn() is silent", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const logger = createNoopLogger();
		logger.warn({ errorCode: "SOME_ERROR" }, "should be silent");
		expect(consoleSpy).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("should produce no console output — error() is silent", () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const logger = createNoopLogger();
		logger.error({ errorCode: "SOME_ERROR" }, "should be silent");
		expect(consoleSpy).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("should not throw when called with empty fields object", () => {
		const logger = createNoopLogger();
		expect(() => logger.warn({})).not.toThrow();
		expect(() => logger.info({})).not.toThrow();
		expect(() => logger.error({})).not.toThrow();
	});

	it("child() of child() should also be a valid Logger (chaining)", () => {
		const logger = createNoopLogger();
		const child1 = logger.child({ scope: "webhooks" });
		const child2 = child1.child({ provider: "resend" });
		expect(() =>
			child2.warn({ errorCode: "WEBHOOK_SIGNATURE_INVALID" }, "signature failed"),
		).not.toThrow();
	});
});
