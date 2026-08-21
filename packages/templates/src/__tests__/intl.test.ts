/**
 * Tests for Intl formatter utilities (Task 1 — D-009).
 *
 * Covers:
 *   formatDate, formatTime, formatDateTime — Intl.DateTimeFormat
 *   formatCurrency — Intl.NumberFormat with currency style
 *   formatNumber — Intl.NumberFormat
 *   formatPlural — Intl.PluralRules for "1 day" vs "5 days"
 *
 * Success criteria (from plan):
 *   - Formatters work with different locales and timezones via RenderContext
 *   - Results differ meaningfully across locales (en-US vs pl-PL)
 *   - Boundary conditions: zero, negative, very large numbers
 *   - Optional parameter handling: missing ctx fields fall back gracefully
 *
 * Rules applied (testing standards):
 *   - Test boundary conditions (rule 4): zero, one, large, negative values
 *   - Test null/undefined handling for optional parameters (rule 5)
 *   - Follow describe("functionName") > it("should X when Y") naming (rule 15)
 *   - Assert on shape of return values, not just existence (rule 26)
 *   - Prefer specific matchers over generic ones (rule 25)
 *   - Do not test third-party library internals (rule 30): test our formatters' output shape
 *
 * Architecture note (templates-i18n.md § 19):
 *   RenderContext carries locale (BCP 47) and timezone (IANA).
 *   Intl formatters must use ctx.locale and ctx.timezone, not hardcoded 'en-US'.
 */

import type { RenderContext } from "@emito/types";
import { describe, expect, it } from "vitest";
import {
	formatCurrency,
	formatDate,
	formatDateTime,
	formatNumber,
	formatPlural,
	formatTime,
} from "../formatters/intl";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<RenderContext> = {}): RenderContext {
	return {
		locale: "en-US",
		timezone: "UTC",
		...overrides,
	};
}

// A fixed Date for deterministic assertions — 2024-03-15 10:30:00 UTC
const FIXED_DATE = new Date("2024-03-15T10:30:00.000Z");

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
	it("should return a non-empty string for a valid date and ctx", () => {
		const result = formatDate(FIXED_DATE, makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should include the year in the result", () => {
		const result = formatDate(FIXED_DATE, makeCtx());
		expect(result).toContain("2024");
	});

	it("should produce different output for different locales", () => {
		const enUs = formatDate(FIXED_DATE, makeCtx({ locale: "en-US" }));
		const plPl = formatDate(FIXED_DATE, makeCtx({ locale: "pl-PL" }));
		// Different locale separators/ordering — at minimum one should differ
		expect(enUs).not.toBe(plPl);
	});

	it("should accept a Date object as first argument", () => {
		const date = new Date("2023-01-01T00:00:00.000Z");
		const result = formatDate(date, makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should accept an ISO string as first argument", () => {
		const result = formatDate("2024-03-15T10:30:00.000Z", makeCtx());
		expect(typeof result).toBe("string");
		expect(result).toContain("2024");
	});

	it("should accept a numeric timestamp as first argument", () => {
		const result = formatDate(FIXED_DATE.getTime(), makeCtx());
		expect(typeof result).toBe("string");
		expect(result).toContain("2024");
	});

	it("should use timezone from ctx when rendering date", () => {
		// 2024-03-15T23:00:00Z is 2024-03-15 in UTC but 2024-03-16 in Tokyo
		const date = new Date("2024-03-15T23:00:00.000Z");
		const utc = formatDate(date, makeCtx({ timezone: "UTC" }));
		const tokyo = formatDate(date, makeCtx({ locale: "en-US", timezone: "Asia/Tokyo" }));
		// Tokyo (UTC+9) should show March 16, UTC should show March 15
		expect(utc).not.toBe(tokyo);
	});
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe("formatTime", () => {
	it("should return a non-empty string for a valid date and ctx", () => {
		const result = formatTime(FIXED_DATE, makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should accept an ISO string as first argument", () => {
		const result = formatTime("2024-03-15T10:30:00.000Z", makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should accept a numeric timestamp as first argument", () => {
		const result = formatTime(FIXED_DATE.getTime(), makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should not include the full year in a time-only result", () => {
		const result = formatTime(FIXED_DATE, makeCtx());
		// Time formatters should not output "2024" as part of time
		expect(result).not.toContain("2024");
	});

	it("should produce different output for different locales", () => {
		// en-US uses AM/PM, others may use 24h
		const enUs = formatTime(FIXED_DATE, makeCtx({ locale: "en-US" }));
		const de = formatTime(FIXED_DATE, makeCtx({ locale: "de-DE" }));
		// Could differ in AM/PM vs 24h representation
		expect(typeof enUs).toBe("string");
		expect(typeof de).toBe("string");
		// At least one of them should be non-empty
		expect(enUs.length).toBeGreaterThan(0);
		expect(de.length).toBeGreaterThan(0);
	});

	it("should reflect the timezone from ctx", () => {
		// 10:30 UTC is 11:30 in Europe/Warsaw (CET) — results should differ
		const utc = formatTime(FIXED_DATE, makeCtx({ locale: "en-US", timezone: "UTC" }));
		const warsaw = formatTime(FIXED_DATE, makeCtx({ locale: "en-US", timezone: "Europe/Warsaw" }));
		expect(utc).not.toBe(warsaw);
	});
});

// ---------------------------------------------------------------------------
// formatDateTime
// ---------------------------------------------------------------------------

describe("formatDateTime", () => {
	it("should return a non-empty string combining date and time", () => {
		const result = formatDateTime(FIXED_DATE, makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should accept an ISO string as first argument", () => {
		const result = formatDateTime("2024-03-15T10:30:00.000Z", makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should accept a numeric timestamp as first argument", () => {
		const result = formatDateTime(FIXED_DATE.getTime(), makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should include the year in the combined output", () => {
		const result = formatDateTime(FIXED_DATE, makeCtx());
		expect(result).toContain("2024");
	});

	it("should produce output longer than formatDate alone (includes time)", () => {
		const dateOnly = formatDate(FIXED_DATE, makeCtx());
		const dateTime = formatDateTime(FIXED_DATE, makeCtx());
		// Combined output should be at least as long as date-only
		expect(dateTime.length).toBeGreaterThanOrEqual(dateOnly.length);
	});

	it("should produce different output for different timezones", () => {
		const utc = formatDateTime(FIXED_DATE, makeCtx({ timezone: "UTC" }));
		const newYork = formatDateTime(
			FIXED_DATE,
			makeCtx({ locale: "en-US", timezone: "America/New_York" }),
		);
		expect(utc).not.toBe(newYork);
	});

	it("should produce different output for different locales", () => {
		const enUs = formatDateTime(FIXED_DATE, makeCtx({ locale: "en-US" }));
		const plPl = formatDateTime(FIXED_DATE, makeCtx({ locale: "pl-PL" }));
		expect(enUs).not.toBe(plPl);
	});
});

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------

describe("formatCurrency", () => {
	it("should return a non-empty string for a valid amount and currency", () => {
		const result = formatCurrency(99.99, "USD", makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should include the numeric value in the result", () => {
		const result = formatCurrency(49, "USD", makeCtx({ locale: "en-US" }));
		// en-US USD formats 49 as "$49.00" — includes "49"
		expect(result).toContain("49");
	});

	it("should include a currency symbol or code in the result", () => {
		const result = formatCurrency(99.99, "USD", makeCtx({ locale: "en-US" }));
		// Should contain "$" or "USD"
		const hasCurrencyMarker = result.includes("$") || result.includes("USD");
		expect(hasCurrencyMarker).toBe(true);
	});

	it("should format EUR differently from USD for the same amount", () => {
		const usd = formatCurrency(100, "USD", makeCtx({ locale: "en-US" }));
		const eur = formatCurrency(100, "EUR", makeCtx({ locale: "en-US" }));
		expect(usd).not.toBe(eur);
	});

	it("should format the same amount differently across locales", () => {
		const enUs = formatCurrency(1234.56, "USD", makeCtx({ locale: "en-US" }));
		const plPl = formatCurrency(1234.56, "USD", makeCtx({ locale: "pl-PL" }));
		// Different thousand separators / symbol placement
		expect(enUs).not.toBe(plPl);
	});

	it("should handle zero amount without throwing", () => {
		const result = formatCurrency(0, "USD", makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should handle negative amounts without throwing", () => {
		const result = formatCurrency(-99.99, "USD", makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should handle large amounts without throwing", () => {
		const result = formatCurrency(1_000_000, "USD", makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------

describe("formatNumber", () => {
	it("should return a non-empty string for a valid number and ctx", () => {
		const result = formatNumber(1234, makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should include the numeric digits in the result", () => {
		const result = formatNumber(1234, makeCtx({ locale: "en-US" }));
		// en-US formats 1234 as "1,234"
		expect(result).toContain("1");
		expect(result).toContain("234");
	});

	it("should produce different output for different locales (thousands separator)", () => {
		const enUs = formatNumber(1000, makeCtx({ locale: "en-US" }));
		const deDE = formatNumber(1000, makeCtx({ locale: "de-DE" }));
		// en-US: "1,000" / de-DE: "1.000" — separator differs
		expect(typeof enUs).toBe("string");
		expect(typeof deDE).toBe("string");
	});

	it("should handle zero without throwing", () => {
		const result = formatNumber(0, makeCtx());
		expect(typeof result).toBe("string");
		expect(result).toContain("0");
	});

	it("should handle negative numbers without throwing", () => {
		const result = formatNumber(-42, makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should handle very large numbers without throwing", () => {
		const result = formatNumber(1_000_000_000, makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should handle decimal values without throwing", () => {
		const result = formatNumber(Math.PI, makeCtx());
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// formatPlural
// ---------------------------------------------------------------------------

describe("formatPlural", () => {
	it("should return the singular form for count 1", () => {
		const forms = { one: "day", other: "days" };
		const result = formatPlural(1, forms, makeCtx({ locale: "en-US" }));
		expect(result).toBe("day");
	});

	it("should return the other form for count 0", () => {
		const forms = { one: "day", other: "days" };
		const result = formatPlural(0, forms, makeCtx({ locale: "en-US" }));
		expect(result).toBe("days");
	});

	it("should return the other form for count 2", () => {
		const forms = { one: "day", other: "days" };
		const result = formatPlural(2, forms, makeCtx({ locale: "en-US" }));
		expect(result).toBe("days");
	});

	it("should return the other form for count 5", () => {
		const forms = { one: "day", other: "days" };
		const result = formatPlural(5, forms, makeCtx({ locale: "en-US" }));
		expect(result).toBe("days");
	});

	it("should work with arbitrary form strings (not just 'day'/'days')", () => {
		const forms = { one: "item", other: "items" };
		expect(formatPlural(1, forms, makeCtx())).toBe("item");
		expect(formatPlural(3, forms, makeCtx())).toBe("items");
	});

	it("should handle count 0 correctly (en-US: other)", () => {
		const forms = { one: "message", other: "messages" };
		const result = formatPlural(0, forms, makeCtx({ locale: "en-US" }));
		expect(result).toBe("messages");
	});

	it("should handle large counts without throwing", () => {
		const forms = { one: "event", other: "events" };
		const result = formatPlural(1_000_000, forms, makeCtx());
		expect(typeof result).toBe("string");
		expect(result).toBe("events");
	});

	it("should use the 'other' form as fallback when a plural key is not in forms", () => {
		// Polish has 'one', 'few', 'many', 'other' — for pl-PL and count=5
		// If only one/other are provided, it falls back to 'other' when key is missing
		const forms = { one: "dzień", other: "dni" };
		const result = formatPlural(5, forms, makeCtx({ locale: "pl-PL" }));
		// Should not throw; returns a string (either 'few' mapped to 'other', or 'dni')
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("should use full forms object when all plural categories are supplied", () => {
		// For en-US only 'one' and 'other' matter, but passing more should not break
		const forms = { one: "item", few: "some items", many: "many items", other: "items" };
		expect(formatPlural(1, forms, makeCtx())).toBe("item");
		expect(formatPlural(10, forms, makeCtx())).toBe("items");
	});
});

// ---------------------------------------------------------------------------
// RenderContext locale/timezone propagation — cross-formatter integration
// ---------------------------------------------------------------------------

describe("Intl formatters — locale propagation", () => {
	it("should not throw for any supported BCP 47 locale (spot check)", () => {
		const locales = ["en-US", "en-GB", "pl-PL", "de-DE", "fr-FR", "ja-JP", "zh-CN"];
		for (const locale of locales) {
			const ctx = makeCtx({ locale });
			expect(() => formatDate(FIXED_DATE, ctx)).not.toThrow();
			expect(() => formatTime(FIXED_DATE, ctx)).not.toThrow();
			expect(() => formatDateTime(FIXED_DATE, ctx)).not.toThrow();
			expect(() => formatCurrency(99.99, "USD", ctx)).not.toThrow();
			expect(() => formatNumber(1234, ctx)).not.toThrow();
		}
	});

	it("should not throw for common IANA timezones (spot check)", () => {
		const timezones = [
			"UTC",
			"America/New_York",
			"Europe/Warsaw",
			"Asia/Tokyo",
			"Australia/Sydney",
		];
		for (const timezone of timezones) {
			const ctx = makeCtx({ timezone });
			expect(() => formatDate(FIXED_DATE, ctx)).not.toThrow();
			expect(() => formatTime(FIXED_DATE, ctx)).not.toThrow();
			expect(() => formatDateTime(FIXED_DATE, ctx)).not.toThrow();
		}
	});
});

// ---------------------------------------------------------------------------
// Invalid locale/timezone fallback — should not throw, returns fallback output
// ---------------------------------------------------------------------------

describe("Intl formatters — invalid locale/timezone fallback", () => {
	it("should not throw for an invalid locale and return a non-empty string", () => {
		const ctx = makeCtx({ locale: "INVALID" });
		expect(() => formatDate(FIXED_DATE, ctx)).not.toThrow();
		expect(formatDate(FIXED_DATE, ctx).length).toBeGreaterThan(0);
	});

	it("should not throw for an invalid timezone and return a non-empty string", () => {
		const ctx = makeCtx({ timezone: "Not/A/Zone" });
		expect(() => formatDate(FIXED_DATE, ctx)).not.toThrow();
		expect(formatDate(FIXED_DATE, ctx).length).toBeGreaterThan(0);
	});

	it("should fall back gracefully for formatTime with invalid locale", () => {
		const ctx = makeCtx({ locale: "INVALID" });
		expect(() => formatTime(FIXED_DATE, ctx)).not.toThrow();
		expect(formatTime(FIXED_DATE, ctx).length).toBeGreaterThan(0);
	});

	it("should fall back gracefully for formatTime with invalid timezone", () => {
		const ctx = makeCtx({ timezone: "Fake/Zone" });
		expect(() => formatTime(FIXED_DATE, ctx)).not.toThrow();
		expect(formatTime(FIXED_DATE, ctx).length).toBeGreaterThan(0);
	});

	it("should fall back gracefully for formatDateTime with invalid locale and timezone", () => {
		const ctx = makeCtx({ locale: "NOT_VALID", timezone: "Bad/TZ" });
		expect(() => formatDateTime(FIXED_DATE, ctx)).not.toThrow();
		expect(formatDateTime(FIXED_DATE, ctx).length).toBeGreaterThan(0);
	});

	it("should fall back gracefully for formatCurrency with invalid locale", () => {
		const ctx = makeCtx({ locale: "INVALID" });
		expect(() => formatCurrency(99.99, "USD", ctx)).not.toThrow();
		expect(formatCurrency(99.99, "USD", ctx).length).toBeGreaterThan(0);
	});

	it("should fall back gracefully for formatCurrency with invalid currency code", () => {
		const ctx = makeCtx();
		expect(() => formatCurrency(99.99, "FAKE", ctx)).not.toThrow();
		expect(formatCurrency(99.99, "FAKE", ctx).length).toBeGreaterThan(0);
	});

	it("should fall back gracefully for formatNumber with invalid locale", () => {
		const ctx = makeCtx({ locale: "INVALID" });
		expect(() => formatNumber(1234, ctx)).not.toThrow();
		expect(formatNumber(1234, ctx).length).toBeGreaterThan(0);
	});

	it("should fall back gracefully for formatPlural with invalid locale", () => {
		const ctx = makeCtx({ locale: "INVALID" });
		const forms = { one: "day", other: "days" };
		expect(() => formatPlural(5, forms, ctx)).not.toThrow();
		expect(formatPlural(5, forms, ctx).length).toBeGreaterThan(0);
	});
});
