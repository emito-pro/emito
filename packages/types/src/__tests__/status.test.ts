import { describe, expect, it } from "vitest";
import type { DeliveryStatus, DeliveryStatusCategory } from "../status";
import { classifyStatus, isTerminal } from "../status";

describe("DeliveryStatus", () => {
	it("should include all 17 required status values", () => {
		const allStatuses: DeliveryStatus[] = [
			"pending",
			"sent",
			"delivered",
			"deferred",
			"bounced",
			"failed",
			"suppressed",
			"complained",
			"opened",
			"machine_opened",
			"clicked",
			"unsubscribed",
			"read",
			"digested",
			"blocked_by_preference",
			"blocked_by_consent",
			"blocked_by_admin",
		];
		expect(allStatuses).toHaveLength(17);
	});
});

describe("classifyStatus", () => {
	it("should classify engagement statuses correctly", () => {
		const engagementStatuses: DeliveryStatus[] = [
			"complained",
			"opened",
			"machine_opened",
			"clicked",
			"unsubscribed",
			"read",
		];

		for (const status of engagementStatuses) {
			const result: DeliveryStatusCategory = classifyStatus(status);
			expect(result).toBe("engagement");
		}
	});

	it("should classify delivery statuses correctly", () => {
		const deliveryStatuses: DeliveryStatus[] = [
			"pending",
			"sent",
			"delivered",
			"deferred",
			"bounced",
			"failed",
			"suppressed",
			"digested",
			"blocked_by_preference",
			"blocked_by_consent",
			"blocked_by_admin",
		];

		for (const status of deliveryStatuses) {
			const result: DeliveryStatusCategory = classifyStatus(status);
			expect(result).toBe("delivery");
		}
	});
});

describe("isTerminal", () => {
	it("should mark delivered as terminal", () => {
		expect(isTerminal("delivered")).toBe(true);
	});

	it("should mark bounced as terminal", () => {
		expect(isTerminal("bounced")).toBe(true);
	});

	it("should mark failed as terminal", () => {
		expect(isTerminal("failed")).toBe(true);
	});

	it("should mark suppressed as terminal", () => {
		expect(isTerminal("suppressed")).toBe(true);
	});

	it("should mark blocked_by_preference as terminal", () => {
		expect(isTerminal("blocked_by_preference")).toBe(true);
	});

	it("should mark blocked_by_consent as terminal", () => {
		expect(isTerminal("blocked_by_consent")).toBe(true);
	});

	it("should mark blocked_by_admin as terminal", () => {
		expect(isTerminal("blocked_by_admin")).toBe(true);
	});

	it("should mark pending as non-terminal", () => {
		expect(isTerminal("pending")).toBe(false);
	});

	it("should mark sent as non-terminal", () => {
		expect(isTerminal("sent")).toBe(false);
	});

	it("should mark deferred as non-terminal", () => {
		expect(isTerminal("deferred")).toBe(false);
	});

	it("should mark engagement statuses as non-terminal", () => {
		const engagementStatuses: DeliveryStatus[] = [
			"complained",
			"opened",
			"machine_opened",
			"clicked",
			"unsubscribed",
			"read",
		];

		for (const status of engagementStatuses) {
			expect(isTerminal(status)).toBe(false);
		}
	});

	it("should mark digested as non-terminal", () => {
		expect(isTerminal("digested")).toBe(false);
	});
});
