/**
 * Unit tests for htmlEscape() utility.
 *
 * Rules applied:
 * - Test boundary conditions (rule 4)
 * - Test empty string (rule 6)
 * - Prefer specific matchers (rule 25)
 * - Assert on shape of return values (rule 26)
 */

import { describe, expect, it } from "vitest";
import { htmlEscape } from "../../html/escape.js";

describe("htmlEscape", () => {
	it("should return empty string unchanged", () => {
		expect(htmlEscape("")).toBe("");
	});

	it("should return plain text unchanged", () => {
		expect(htmlEscape("Hello, World!")).toBe("Hello, World!");
	});

	it("should escape ampersand &", () => {
		expect(htmlEscape("a & b")).toBe("a &amp; b");
	});

	it("should escape less-than <", () => {
		expect(htmlEscape("a < b")).toBe("a &lt; b");
	});

	it("should escape greater-than >", () => {
		expect(htmlEscape("a > b")).toBe("a &gt; b");
	});

	it('should escape double quote "', () => {
		expect(htmlEscape('say "hello"')).toBe("say &quot;hello&quot;");
	});

	it("should escape single quote '", () => {
		expect(htmlEscape("it's")).toBe("it&#x27;s");
	});

	it("should escape all five dangerous characters in a single string", () => {
		const input = `<script>alert('XSS & "hack"')</script>`;
		const result = htmlEscape(input);
		// The raw dangerous chars must not appear unescaped
		// (& is allowed as part of escape sequences like &lt; — check no bare & is present)
		expect(result).toContain("&lt;");
		expect(result).toContain("&gt;");
		expect(result).toContain("&amp;");
		expect(result).toContain("&quot;");
		expect(result).toContain("&#x27;");
		// The raw unescaped chars must not appear outside an escape sequence
		expect(result).not.toContain("<script");
		expect(result).not.toContain("</script>");
	});

	it("should handle a script tag XSS payload", () => {
		const xssPayload = `<script>document.cookie="pwned"</script>`;
		const escaped = htmlEscape(xssPayload);
		expect(escaped).not.toContain("<script>");
		expect(escaped).toContain("&lt;script&gt;");
	});

	it("should handle event handler XSS payload", () => {
		const xssPayload = `" onmouseover="alert(1)`;
		const escaped = htmlEscape(xssPayload);
		expect(escaped).not.toContain('"');
		expect(escaped).toContain("&quot;");
	});

	it("should handle javascript: URI XSS payload", () => {
		const xssPayload = `<a href="javascript:alert(1)">click</a>`;
		const escaped = htmlEscape(xssPayload);
		expect(escaped).not.toContain("<a");
		expect(escaped).toContain("&lt;a");
	});

	it("should escape multiple occurrences of the same character", () => {
		expect(htmlEscape("<<<")).toBe("&lt;&lt;&lt;");
		expect(htmlEscape(">>>")).toBe("&gt;&gt;&gt;");
		expect(htmlEscape('"""')).toBe("&quot;&quot;&quot;");
	});

	it("should handle email addresses with angle brackets safely", () => {
		const input = "User <user@example.com>";
		const result = htmlEscape(input);
		expect(result).not.toContain("<");
		expect(result).not.toContain(">");
		expect(result).toContain("&lt;");
		expect(result).toContain("&gt;");
	});
});
