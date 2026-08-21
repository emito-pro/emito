import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { describe, expect, it } from "vitest";
import { createEventRegistry } from "../src/event-registry";

const testEvents = {
	"order.filled": {
		category: "transactional",
		channels: ["email" as const, "inApp" as const],
		priority: "high" as const,
	},
	"newsletter.weekly": {
		category: "marketing",
		channels: ["email" as const],
	},
	"feature.released": {
		category: "product",
		channels: ["email" as const, "push" as const],
		description: "New feature announcement",
	},
};

describe("EventRegistry", () => {
	describe("getEvent", () => {
		it("returns the event definition for a known event", () => {
			const registry = createEventRegistry(testEvents);
			const event = registry.getEvent("order.filled");

			expect(event).toEqual({
				category: "transactional",
				channels: ["email", "inApp"],
				priority: "high",
			});
		});

		it("returns event definition with all fields", () => {
			const registry = createEventRegistry(testEvents);
			const event = registry.getEvent("feature.released");

			expect(event.category).toBe("product");
			expect(event.channels).toEqual(["email", "push"]);
			expect(event.description).toBe("New feature announcement");
		});

		it("throws CONFIG_INVALID for unknown event", () => {
			const registry = createEventRegistry(testEvents);

			expect(() => registry.getEvent("unknown.event" as keyof typeof testEvents)).toThrow(
				EmitoError,
			);

			try {
				registry.getEvent("unknown.event" as keyof typeof testEvents);
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
				expect(error.isRetryable).toBe(false);
				expect(error.context).toEqual({ eventName: "unknown.event" });
			}
		});

		it("throws CONFIG_INVALID for empty string event name", () => {
			const registry = createEventRegistry(testEvents);

			expect(() => registry.getEvent("" as keyof typeof testEvents)).toThrow(EmitoError);
		});
	});

	describe("hasEvent", () => {
		it("returns true for a known event", () => {
			const registry = createEventRegistry(testEvents);
			expect(registry.hasEvent("order.filled")).toBe(true);
		});

		it("returns false for an unknown event", () => {
			const registry = createEventRegistry(testEvents);
			expect(registry.hasEvent("unknown.event")).toBe(false);
		});
	});

	describe("getEventNames", () => {
		it("returns all event names", () => {
			const registry = createEventRegistry(testEvents);
			const names = registry.getEventNames();

			expect(names).toHaveLength(3);
			expect(names).toContain("order.filled");
			expect(names).toContain("newsletter.weekly");
			expect(names).toContain("feature.released");
		});

		it("returns empty array for empty registry", () => {
			const registry = createEventRegistry({});
			expect(registry.getEventNames()).toEqual([]);
		});
	});

	describe("edge cases", () => {
		it("handles single event registry", () => {
			const registry = createEventRegistry({
				"only.event": { category: "transactional", channels: ["email"] },
			});

			expect(registry.getEvent("only.event")).toEqual({
				category: "transactional",
				channels: ["email"],
			});
			expect(registry.getEventNames()).toHaveLength(1);
		});

		it("preserves event definitions with optional fields", () => {
			const registry = createEventRegistry({
				"digest.event": {
					category: "product",
					channels: ["email"],
					digest: { windowMs: 60000, maxCount: 10 },
					bypassPreferences: true,
					bypassRateLimit: false,
				},
			});

			const event = registry.getEvent("digest.event");
			expect(event.digest).toEqual({ windowMs: 60000, maxCount: 10 });
			expect(event.bypassPreferences).toBe(true);
			expect(event.bypassRateLimit).toBe(false);
		});
	});
});
