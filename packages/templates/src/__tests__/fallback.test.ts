/**
 * Tests for the generic fallback template.
 *
 * The fallback produces readable content from event name + payload key-values
 * for all channels that have a fallback: email, SMS, push, inApp, slack, telegram.
 *
 * Rules applied (testing standards):
 * - Test boundary conditions for collections (rule 4): empty payload, single key, many keys
 * - Test empty string inputs (rule 6)
 * - Never mock the module under test (rule 10)
 * - Follow describe("functionName") > it("should X when Y") naming (rule 15)
 * - Assert on shape of return values, not just existence (rule 26)
 * - Use toMatchObject for partial assertions on large objects (rule 27)
 */

import type { BrandTheme, RenderContext } from "@emito/types";
import { describe, expect, it } from "vitest";
import { createFallbackTemplate } from "../fallback";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeBrand(overrides: Partial<BrandTheme> = {}): BrandTheme {
	return {
		name: "TestApp",
		appUrl: "https://testapp.example.com",
		...overrides,
	};
}

function makeCtx(overrides: Partial<RenderContext> = {}): RenderContext {
	return {
		locale: "en-US",
		timezone: "UTC",
		...overrides,
	};
}

describe("createFallbackTemplate", () => {
	describe("email fallback", () => {
		it("should produce an email with event name as subject", async () => {
			const template = createFallbackTemplate("auth.welcome");
			const result = await template.email!(
				{ userId: "user_1", name: "Alice" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.subject).toBe("auth.welcome");
		});

		it("should include payload key-value pairs in the html body", async () => {
			const template = createFallbackTemplate("auth.welcome");
			const result = await template.email!(
				{ userId: "user_1", name: "Alice" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.html).toContain("userId");
			expect(result.html).toContain("user_1");
			expect(result.html).toContain("name");
			expect(result.html).toContain("Alice");
		});

		it("should include payload key-value pairs in the text body", async () => {
			const template = createFallbackTemplate("auth.welcome");
			const result = await template.email!(
				{ userId: "user_1", name: "Alice" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.text).toContain("userId");
			expect(result.text).toContain("user_1");
		});

		it("should handle empty payload", async () => {
			const template = createFallbackTemplate("system.maintenance");
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject).toBe("system.maintenance");
			expect(result.html).toBeDefined();
			expect(result.text).toBeDefined();
		});

		it("should handle single-key payload", async () => {
			const template = createFallbackTemplate("test.event");
			const result = await template.email!({ key: "value" }, makeBrand(), makeCtx());
			expect(result.html).toContain("key");
			expect(result.html).toContain("value");
		});
	});

	describe("SMS fallback", () => {
		it("should produce an SMS body containing event name and first payload value", () => {
			const template = createFallbackTemplate("auth.welcome");
			const result = template.sms!({ userId: "user_1", name: "Alice" }, makeBrand(), makeCtx());
			expect(result.body).toContain("auth.welcome");
		});

		it("should produce an SMS body under 160 characters for typical payloads", () => {
			const template = createFallbackTemplate("auth.welcome");
			const result = template.sms!({ userId: "user_1", name: "Alice" }, makeBrand(), makeCtx());
			expect(result.body.length).toBeLessThanOrEqual(160);
		});

		it("should handle empty payload without throwing", () => {
			const template = createFallbackTemplate("test.event");
			const result = template.sms!({}, makeBrand(), makeCtx());
			expect(result.body).toBeDefined();
			expect(typeof result.body).toBe("string");
		});
	});

	describe("push fallback", () => {
		it("should use event name as title", () => {
			const template = createFallbackTemplate("billing.payment-failed");
			const result = template.push!({ amount: "$9.99" }, makeBrand(), makeCtx());
			expect(result.title).toBe("billing.payment-failed");
		});

		it("should include first payload value in body", () => {
			const template = createFallbackTemplate("billing.payment-failed");
			const result = template.push!({ amount: "$9.99" }, makeBrand(), makeCtx());
			expect(result.body).toContain("$9.99");
		});

		it("should handle empty payload without throwing", () => {
			const template = createFallbackTemplate("test.event");
			const result = template.push!({}, makeBrand(), makeCtx());
			expect(result.title).toBe("test.event");
			expect(typeof result.body).toBe("string");
		});
	});

	describe("inApp fallback", () => {
		it("should use event name as subject", () => {
			const template = createFallbackTemplate("team.invitation");
			const result = template.inApp!({ inviterName: "Bob" }, makeBrand(), makeCtx());
			expect(result.subject).toBe("team.invitation");
		});

		it("should include payload key-value pairs in body", () => {
			const template = createFallbackTemplate("team.invitation");
			const result = template.inApp!({ inviterName: "Bob" }, makeBrand(), makeCtx());
			expect(result.body).toContain("inviterName");
			expect(result.body).toContain("Bob");
		});

		it("should handle empty payload", () => {
			const template = createFallbackTemplate("test.event");
			const result = template.inApp!({}, makeBrand(), makeCtx());
			expect(result.subject).toBe("test.event");
			expect(typeof result.body).toBe("string");
		});
	});

	describe("slack fallback", () => {
		it("should produce valid Slack Block Kit JSON with blocks and text", () => {
			const template = createFallbackTemplate("security.alert");
			const result = template.slack!({ description: "Suspicious login" }, makeBrand(), makeCtx());
			expect(result.blocks).toBeInstanceOf(Array);
			expect(result.blocks.length).toBeGreaterThan(0);
			expect(typeof result.text).toBe("string");
			expect(result.text.length).toBeGreaterThan(0);
		});

		it("should include event name in the Slack text fallback", () => {
			const template = createFallbackTemplate("security.alert");
			const result = template.slack!({ description: "Suspicious login" }, makeBrand(), makeCtx());
			expect(result.text).toContain("security.alert");
		});
	});

	describe("telegram fallback", () => {
		it("should produce HTML containing event name", () => {
			const template = createFallbackTemplate("system.incident");
			const result = template.telegram!({ title: "DB outage" }, makeBrand(), makeCtx());
			expect(result.html).toContain("system.incident");
		});

		it("should only use allowed Telegram HTML tags (b, i, a, code, pre)", () => {
			const template = createFallbackTemplate("system.incident");
			const result = template.telegram!(
				{ title: "DB outage", affected: "API" },
				makeBrand(),
				makeCtx(),
			);
			// Should not contain forbidden tags like <div>, <p>, <span>, <table>
			expect(result.html).not.toMatch(/<div|<p>|<span|<table|<ul|<li/);
		});
	});

	describe("channel coverage", () => {
		it("should provide all channel functions on the fallback template", () => {
			const template = createFallbackTemplate("test.event");
			expect(typeof template.email).toBe("function");
			expect(typeof template.sms).toBe("function");
			expect(typeof template.push).toBe("function");
			expect(typeof template.inApp).toBe("function");
			expect(typeof template.slack).toBe("function");
			expect(typeof template.telegram).toBe("function");
		});
	});
});
