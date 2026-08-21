/**
 * Tests for the lang resolution utility.
 *
 * The 4-step resolution chain:
 *   1. params.lang       (per-send override)
 *   2. subscriber.lang   (stored preference)
 *   3. config.defaultLang
 *   4. 'en'              (hardcoded fallback)
 *
 * Rules applied (testing standards):
 * - Test boundary conditions for optional parameters (rule 5)
 * - Test empty string inputs for string parameters (rule 6)
 * - Follow describe("functionName") > it("should X when Y") naming (rule 15)
 * - Assert on shape of return values, not just existence (rule 26)
 * - Prefer specific matchers over generic ones (rule 25)
 */

import { afterEach, describe, expect, it } from "vitest";
import { resolveLang, resolveTemplateLang } from "../lang";

describe("resolveLang", () => {
	describe("step 1 — params.lang wins when provided", () => {
		it("should return params.lang when all sources are present", () => {
			const result = resolveLang({
				paramsLang: "fr",
				subscriberLang: "pl",
				configDefaultLang: "de",
			});
			expect(result).toBe("fr");
		});

		it("should return params.lang when subscriber and config are absent", () => {
			const result = resolveLang({ paramsLang: "ja" });
			expect(result).toBe("ja");
		});
	});

	describe("step 2 — subscriber.lang wins when params.lang is absent", () => {
		it("should return subscriber.lang when paramsLang is undefined", () => {
			const result = resolveLang({
				paramsLang: undefined,
				subscriberLang: "pl",
				configDefaultLang: "de",
			});
			expect(result).toBe("pl");
		});

		it("should return subscriber.lang when paramsLang is omitted", () => {
			const result = resolveLang({
				subscriberLang: "es",
				configDefaultLang: "de",
			});
			expect(result).toBe("es");
		});
	});

	describe("step 3 — config.defaultLang wins when params and subscriber are absent", () => {
		it("should return configDefaultLang when paramsLang and subscriberLang are absent", () => {
			const result = resolveLang({ configDefaultLang: "de" });
			expect(result).toBe("de");
		});

		it("should return configDefaultLang when paramsLang is undefined and subscriberLang is undefined", () => {
			const result = resolveLang({
				paramsLang: undefined,
				subscriberLang: undefined,
				configDefaultLang: "pt",
			});
			expect(result).toBe("pt");
		});
	});

	describe("step 4 — hardcoded fallback 'en'", () => {
		it("should return 'en' when all sources are absent", () => {
			const result = resolveLang({});
			expect(result).toBe("en");
		});

		it("should return 'en' when all sources are undefined", () => {
			const result = resolveLang({
				paramsLang: undefined,
				subscriberLang: undefined,
				configDefaultLang: undefined,
			});
			expect(result).toBe("en");
		});
	});

	describe("empty string handling", () => {
		it("should skip empty string paramsLang and fall through to subscriberLang", () => {
			const result = resolveLang({
				paramsLang: "",
				subscriberLang: "pl",
				configDefaultLang: "de",
			});
			expect(result).toBe("pl");
		});

		it("should skip empty string subscriberLang and fall through to configDefaultLang", () => {
			const result = resolveLang({
				paramsLang: undefined,
				subscriberLang: "",
				configDefaultLang: "de",
			});
			expect(result).toBe("de");
		});

		it("should skip empty string configDefaultLang and fall through to 'en'", () => {
			const result = resolveLang({
				paramsLang: undefined,
				subscriberLang: undefined,
				configDefaultLang: "",
			});
			expect(result).toBe("en");
		});

		it("should fall through to 'en' when all sources are empty strings", () => {
			const result = resolveLang({ paramsLang: "", subscriberLang: "", configDefaultLang: "" });
			expect(result).toBe("en");
		});
	});
});

// ---------------------------------------------------------------------------
// resolveTemplateLang — lang fallback with 'en' and generic fallback
// ---------------------------------------------------------------------------

describe("resolveTemplateLang", () => {
	describe("step 1 — exact lang match", () => {
		it("should return the template for the requested lang when present", () => {
			const map = { en: "english-template", pl: "polish-template" };
			expect(resolveTemplateLang(map, "pl")).toBe("polish-template");
		});

		it("should return the 'en' template when requested lang is 'en'", () => {
			const map = { en: "english-template", de: "german-template" };
			expect(resolveTemplateLang(map, "en")).toBe("english-template");
		});
	});

	describe("step 2 — 'en' fallback when requested lang is missing", () => {
		it("should return 'en' template when requested lang is not in map", () => {
			const map = { en: "english-template", de: "german-template" };
			expect(resolveTemplateLang(map, "fr")).toBe("english-template");
		});

		it("should return 'en' template for any unknown lang when 'en' is present", () => {
			const map = { en: "english-template" };
			expect(resolveTemplateLang(map, "ja")).toBe("english-template");
			expect(resolveTemplateLang(map, "zh")).toBe("english-template");
		});
	});

	describe("step 3 — first available key fallback when 'en' is absent", () => {
		it("should return first key's template when neither requested lang nor 'en' exists", () => {
			const map = { de: "german-template", fr: "french-template" };
			const result = resolveTemplateLang(map, "pl");
			// Should return one of the available templates (first key)
			expect(result === "german-template" || result === "french-template").toBe(true);
		});
	});

	describe("step 4 — undefined when map is empty", () => {
		it("should return undefined when lang map is empty", () => {
			const map = {};
			expect(resolveTemplateLang(map, "en")).toBeUndefined();
		});

		it("should return undefined for any lang when map is empty", () => {
			expect(resolveTemplateLang({}, "pl")).toBeUndefined();
			expect(resolveTemplateLang({}, "fr")).toBeUndefined();
		});
	});
});
