/**
 * Tests for the template builder utility.
 *
 * The builder converts lang → channel → strings maps into
 * Record<string, EventTemplate> (keyed by lang).
 *
 * Rules applied (testing standards):
 * - Test boundary conditions: single lang, multiple langs, missing channels (rule 4)
 * - Test empty string / undefined handling for optional parameters (rules 5, 6)
 * - Never mock the module under test (rule 10)
 * - Follow describe("functionName") > it("should X when Y") naming (rule 15)
 * - Assert on shape of return values, not just existence (rule 26)
 * - Use toMatchObject for partial assertions on large objects (rule 27)
 */

import type { BrandTheme, RenderContext } from "@emito/types";
import { describe, expect, it } from "vitest";
import { buildTemplate } from "../builder";

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

describe("buildTemplate", () => {
	describe("output structure", () => {
		it("should return a Record keyed by lang", () => {
			const result = buildTemplate({
				en: {
					email: {
						subject: "Hello!",
						heading: "Welcome",
						body: "Great to have you.",
						cta: "Start",
					},
					sms: { body: "Welcome!" },
				},
			});
			expect(result).toHaveProperty("en");
		});

		it("should produce an EventTemplate for each lang key", () => {
			const result = buildTemplate({
				en: {
					email: {
						subject: "Hello!",
						heading: "Welcome",
						body: "Great to have you.",
						cta: "Start",
					},
				},
				pl: {
					email: {
						subject: "Cześć!",
						heading: "Witamy",
						body: "Świetnie, że jesteś.",
						cta: "Start",
					},
				},
			});
			expect(result).toHaveProperty("en");
			expect(result).toHaveProperty("pl");
		});

		it("should include only langs present in the input map", () => {
			const result = buildTemplate({
				en: {
					sms: { body: "Hello!" },
				},
			});
			const langKeys = Object.keys(result);
			expect(langKeys).toEqual(["en"]);
		});
	});

	describe("email channel", () => {
		it("should produce an async email function", async () => {
			const result = buildTemplate({
				en: {
					email: {
						subject: "Welcome!",
						heading: "Hello there",
						body: "Glad you joined.",
						cta: "Get Started",
					},
				},
			});
			expect(typeof result.en?.email).toBe("function");
			const content = await result.en?.email?.({}, makeBrand(), makeCtx());
			expect(content?.subject).toBe("Welcome!");
			expect(typeof content?.html).toBe("string");
			expect(typeof content?.text).toBe("string");
		});

		it("should incorporate BrandTheme into rendered HTML", async () => {
			const result = buildTemplate({
				en: {
					email: {
						subject: "Welcome to TestApp!",
						heading: "Welcome",
						body: "Here we go.",
						cta: "Start",
					},
				},
			});
			const brand = makeBrand({ name: "MyBrand", primaryColor: "#ff0000" });
			const content = await result.en?.email?.({}, brand, makeCtx());
			expect(content?.html).toContain("MyBrand");
		});

		it("should not produce an email function when email strings are not provided for the lang", () => {
			const result = buildTemplate({
				en: {
					sms: { body: "SMS only" },
				},
			});
			expect(result.en?.email).toBeUndefined();
		});
	});

	describe("SMS channel", () => {
		it("should produce an SMS function when sms strings are provided", () => {
			const result = buildTemplate({
				en: {
					sms: { body: "Welcome!" },
				},
			});
			expect(typeof result.en?.sms).toBe("function");
			const content = result.en?.sms?.({}, makeBrand(), makeCtx());
			expect(content?.body).toBe("Welcome!");
		});

		it("should not produce an SMS function when sms strings are absent", () => {
			const result = buildTemplate({
				en: {
					push: { title: "Hello", body: "World" },
				},
			});
			expect(result.en?.sms).toBeUndefined();
		});
	});

	describe("push channel", () => {
		it("should produce a push function when push strings are provided", () => {
			const result = buildTemplate({
				en: {
					push: { title: "Welcome!", body: "Your account is ready." },
				},
			});
			expect(typeof result.en?.push).toBe("function");
			const content = result.en?.push?.({}, makeBrand(), makeCtx());
			expect(content?.title).toBe("Welcome!");
			expect(content?.body).toBe("Your account is ready.");
		});
	});

	describe("inApp channel", () => {
		it("should produce an inApp function with optional actionUrl", () => {
			const result = buildTemplate({
				en: {
					inApp: { subject: "Welcome!", body: "Your account is ready.", actionUrl: "/start" },
				},
			});
			expect(typeof result.en?.inApp).toBe("function");
			const content = result.en?.inApp?.({}, makeBrand(), makeCtx());
			expect(content?.subject).toBe("Welcome!");
			expect(content?.body).toBe("Your account is ready.");
			expect(content?.actionUrl).toBe("/start");
		});
	});

	describe("Slack channel", () => {
		it("should produce a Slack function when Slack strings are provided", () => {
			const result = buildTemplate({
				en: {
					slack: { header: "Welcome", body: "A new user joined" },
				},
			});
			expect(typeof result.en?.slack).toBe("function");
			const content = result.en?.slack?.({}, makeBrand(), makeCtx());
			expect(content?.blocks).toBeInstanceOf(Array);
			expect(content?.blocks.length).toBeGreaterThan(0);
			expect(typeof content?.text).toBe("string");
		});
	});

	describe("multiple langs", () => {
		it("should produce independent EventTemplate functions per lang", async () => {
			const result = buildTemplate({
				en: {
					sms: { body: "Welcome!" },
				},
				pl: {
					sms: { body: "Witamy!" },
				},
			});
			const enContent = result.en?.sms?.({}, makeBrand(), makeCtx());
			const plContent = result.pl?.sms?.({}, makeBrand(), makeCtx());
			expect(enContent?.body).toBe("Welcome!");
			expect(plContent?.body).toBe("Witamy!");
		});
	});

	describe("payload interpolation", () => {
		it("should support function-based body that receives payload", () => {
			const result = buildTemplate({
				en: {
					sms: {
						body: (payload: Record<string, unknown>) => `Welcome ${payload.name}!`,
					},
				},
			});
			const content = result.en?.sms?.({ name: "Alice" }, makeBrand(), makeCtx());
			expect(content?.body).toBe("Welcome Alice!");
		});
	});
});
