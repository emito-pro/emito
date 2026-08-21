import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "../src/utils/relative-time.js";

const NOW = new Date("2026-04-16T12:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("formatRelativeTime", () => {
	it('returns "just now" for timestamps less than 1 minute ago', () => {
		const thirtySecondsAgo = new Date(NOW - 30_000).toISOString();
		expect(formatRelativeTime(thirtySecondsAgo)).toBe("just now");
	});

	it('returns "just now" for 0 seconds ago', () => {
		expect(formatRelativeTime(new Date(NOW).toISOString())).toBe("just now");
	});

	it("returns minutes ago for timestamps 1-59 minutes ago", () => {
		const fiveMinutesAgo = new Date(NOW - 5 * 60_000).toISOString();
		expect(formatRelativeTime(fiveMinutesAgo)).toBe("5m ago");
	});

	it("returns 1m ago at exactly 60 seconds", () => {
		const oneMinuteAgo = new Date(NOW - 60_000).toISOString();
		expect(formatRelativeTime(oneMinuteAgo)).toBe("1m ago");
	});

	it("returns hours ago for timestamps 1-23 hours ago", () => {
		const threeHoursAgo = new Date(NOW - 3 * 3_600_000).toISOString();
		expect(formatRelativeTime(threeHoursAgo)).toBe("3h ago");
	});

	it("returns 1h ago at exactly 60 minutes", () => {
		const oneHourAgo = new Date(NOW - 3_600_000).toISOString();
		expect(formatRelativeTime(oneHourAgo)).toBe("1h ago");
	});

	it('returns "Yesterday" for timestamps 24-47 hours ago', () => {
		const yesterday = new Date(NOW - 30 * 3_600_000).toISOString();
		expect(formatRelativeTime(yesterday)).toBe("Yesterday");
	});

	it("returns days ago for timestamps 2-6 days ago", () => {
		const threeDaysAgo = new Date(NOW - 3 * 86_400_000).toISOString();
		expect(formatRelativeTime(threeDaysAgo)).toBe("3d ago");
	});

	it("returns a formatted date for timestamps 7+ days ago", () => {
		const tenDaysAgo = new Date(NOW - 10 * 86_400_000).toISOString();
		const result = formatRelativeTime(tenDaysAgo);
		// Should be a short date string, not a relative time
		expect(result).not.toContain("ago");
		expect(result).not.toBe("just now");
	});

	it("accepts a Date object", () => {
		const fiveMinutesAgo = new Date(NOW - 5 * 60_000);
		expect(formatRelativeTime(fiveMinutesAgo)).toBe("5m ago");
	});

	it("accepts an ISO string", () => {
		const fiveMinutesAgo = new Date(NOW - 5 * 60_000).toISOString();
		expect(formatRelativeTime(fiveMinutesAgo)).toBe("5m ago");
	});

	it("returns 59m ago at 59 minutes 59 seconds", () => {
		const almostAnHour = new Date(NOW - 59 * 60_000 - 59_000).toISOString();
		expect(formatRelativeTime(almostAnHour)).toBe("59m ago");
	});

	it("returns 23h ago at 23 hours 59 minutes", () => {
		const almostADay = new Date(NOW - 23 * 3_600_000 - 59 * 60_000).toISOString();
		expect(formatRelativeTime(almostADay)).toBe("23h ago");
	});

	it("returns 6d ago at exactly 6 days", () => {
		const sixDays = new Date(NOW - 6 * 86_400_000).toISOString();
		expect(formatRelativeTime(sixDays)).toBe("6d ago");
	});
});
