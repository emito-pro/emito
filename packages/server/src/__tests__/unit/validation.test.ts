import { describe, expect, it } from "vitest";
import { parseQueryString } from "../../query.js";

describe("parseQueryString", () => {
	describe("single-value params", () => {
		it("returns a string for a single-occurrence key", () => {
			const url = new URL("https://example.com/path?status=active");
			const result = parseQueryString(url);
			expect(result).toEqual({ status: "active" });
		});

		it("returns empty object for URL with no query params", () => {
			const url = new URL("https://example.com/path");
			const result = parseQueryString(url);
			expect(result).toEqual({});
		});

		it("returns multiple distinct keys as strings", () => {
			const url = new URL("https://example.com/path?cursor=abc&limit=10");
			const result = parseQueryString(url);
			expect(result).toEqual({ cursor: "abc", limit: "10" });
		});

		it("returns empty string for a key with no value", () => {
			const url = new URL("https://example.com/path?flag=");
			const result = parseQueryString(url);
			expect(result).toEqual({ flag: "" });
		});
	});

	describe("duplicate key (array) params (D-017)", () => {
		it("returns an array for a key that appears twice", () => {
			const url = new URL("https://example.com/path?channel=email&channel=sms");
			const result = parseQueryString(url);
			expect(result).toEqual({ channel: ["email", "sms"] });
		});

		it("returns an array for a key that appears three times", () => {
			const url = new URL("https://example.com/path?tag=a&tag=b&tag=c");
			const result = parseQueryString(url);
			expect(result).toEqual({ tag: ["a", "b", "c"] });
		});

		it("preserves order of duplicate values", () => {
			const url = new URL("https://example.com/path?id=3&id=1&id=2");
			const result = parseQueryString(url);
			expect(result).toEqual({ id: ["3", "1", "2"] });
		});

		it("mixes single and duplicate keys correctly", () => {
			const url = new URL(
				"https://example.com/path?cursor=tok_abc&channel=email&channel=sms&limit=50",
			);
			const result = parseQueryString(url);
			expect(result).toEqual({
				cursor: "tok_abc",
				channel: ["email", "sms"],
				limit: "50",
			});
		});
	});

	describe("return type", () => {
		it("single key returns a string, not an array", () => {
			const url = new URL("https://example.com/path?key=value");
			const result = parseQueryString(url);
			expect(typeof result.key).toBe("string");
		});

		it("duplicate key returns an array, not a string", () => {
			const url = new URL("https://example.com/path?key=a&key=b");
			const result = parseQueryString(url);
			expect(Array.isArray(result.key)).toBe(true);
		});
	});
});
