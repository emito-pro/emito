/**
 * Tests for isRtl() utility and RTL support in BaseEmailLayout.
 *
 * Success criteria (plan task 1):
 *   - isRtl() exported from templates package index
 *   - isRtl() returns true for ar, he, fa, ur (and their regional variants)
 *   - isRtl() returns false for en, pl, de, fr, etc.
 *   - BaseEmailLayout renders dir="rtl" for RTL locales
 *   - BaseEmailLayout renders dir="ltr" for LTR locales (default)
 *   - direction prop overrides auto-detection
 *   - No visual regression for LTR: HTML output is identical without dir prop change
 *
 * Rules applied (testing standards):
 *   - Prefer specific matchers over generic ones (rule 25)
 *   - Assert on shape of return values, not just existence (rule 26)
 *   - Test boundary conditions for optional parameters (rule 5)
 *   - Test empty string inputs (rule 6)
 *   - Follow describe("functionName") > it("should X when Y") naming (rule 15)
 *   - Never mock the module under test (rule 10)
 */

import type { BrandTheme, RenderContext } from "@emito/types";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { isRtl } from "../index";
import { BaseEmailLayout } from "../layout/base-email-layout";

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

// ---------------------------------------------------------------------------
// isRtl() utility
// ---------------------------------------------------------------------------

describe("isRtl", () => {
	describe("RTL locales — should return true", () => {
		it("should return true for Arabic (ar)", () => {
			expect(isRtl("ar")).toBe(true);
		});

		it("should return true for Hebrew (he)", () => {
			expect(isRtl("he")).toBe(true);
		});

		it("should return true for Persian/Farsi (fa)", () => {
			expect(isRtl("fa")).toBe(true);
		});

		it("should return true for Urdu (ur)", () => {
			expect(isRtl("ur")).toBe(true);
		});

		it("should return true for Arabic with region (ar-SA)", () => {
			expect(isRtl("ar-SA")).toBe(true);
		});

		it("should return true for Arabic with region (ar-EG)", () => {
			expect(isRtl("ar-EG")).toBe(true);
		});

		it("should return true for Hebrew with region (he-IL)", () => {
			expect(isRtl("he-IL")).toBe(true);
		});

		it("should return true for Persian with region (fa-IR)", () => {
			expect(isRtl("fa-IR")).toBe(true);
		});

		it("should return true for Urdu with region (ur-PK)", () => {
			expect(isRtl("ur-PK")).toBe(true);
		});
	});

	describe("LTR locales — should return false", () => {
		it("should return false for English (en)", () => {
			expect(isRtl("en")).toBe(false);
		});

		it("should return false for English with region (en-US)", () => {
			expect(isRtl("en-US")).toBe(false);
		});

		it("should return false for Polish (pl)", () => {
			expect(isRtl("pl")).toBe(false);
		});

		it("should return false for German (de)", () => {
			expect(isRtl("de")).toBe(false);
		});

		it("should return false for French (fr)", () => {
			expect(isRtl("fr")).toBe(false);
		});

		it("should return false for Spanish (es)", () => {
			expect(isRtl("es")).toBe(false);
		});

		it("should return false for Chinese (zh)", () => {
			expect(isRtl("zh")).toBe(false);
		});

		it("should return false for Japanese (ja)", () => {
			expect(isRtl("ja")).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("should return false for empty string", () => {
			expect(isRtl("")).toBe(false);
		});

		it("should not match a locale that starts with an RTL prefix by coincidence (e.g. 'art')", () => {
			// 'art' is not Arabic — only exact language-tag prefix should match
			expect(isRtl("art")).toBe(false);
		});

		it("should not match 'fad' as Persian", () => {
			expect(isRtl("fad")).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// BaseEmailLayout — RTL direction via locale auto-detection
// ---------------------------------------------------------------------------

describe("BaseEmailLayout RTL support", () => {
	describe("auto-detection via locale", () => {
		it('should render dir="ltr" for English locale (default)', async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "en-US" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('dir="ltr"');
		});

		it('should render dir="rtl" for Arabic locale (ar)', async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "ar" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('dir="rtl"');
		});

		it('should render dir="rtl" for Hebrew locale (he-IL)', async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "he-IL" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('dir="rtl"');
		});

		it('should render dir="rtl" for Persian locale (fa-IR)', async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "fa-IR" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('dir="rtl"');
		});

		it('should render dir="rtl" for Urdu locale (ur-PK)', async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "ur-PK" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('dir="rtl"');
		});

		it('should render dir="ltr" for Polish locale (pl)', async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "pl" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('dir="ltr"');
		});

		it('should render dir="ltr" for German locale (de-DE)', async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "de-DE" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('dir="ltr"');
		});
	});

	describe("direction prop override", () => {
		it('should render dir="ltr" when direction="ltr" is passed for RTL locale', async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "ar" })} direction="ltr">
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('dir="ltr"');
		});

		it('should render dir="rtl" when direction="rtl" is passed for LTR locale', async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "en-US" })} direction="rtl">
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('dir="rtl"');
		});

		it("should default to ltr when direction prop is not provided and locale is LTR", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "en-US" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			// dir attribute should be "ltr"
			expect(html).not.toContain('dir="rtl"');
			expect(html).toContain('dir="ltr"');
		});
	});

	describe("no visual regression for LTR", () => {
		it("should render children content for LTR locale without regression", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "en-US" })}>
					<div>UNIQUE_LTR_CONTENT</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("UNIQUE_LTR_CONTENT");
			expect(html).toContain("<html");
			expect(html).toContain("</html>");
			expect(html).toContain("TestApp");
		});

		it("should include lang attribute matching the locale language prefix", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "en-US" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('lang="en"');
		});

		it("should include lang attribute for RTL locale", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx({ locale: "ar-SA" })}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain('lang="ar"');
		});

		it("should render brand, children, and footer for RTL locale the same as LTR (no content regression)", async () => {
			const brand = makeBrand({
				name: "AcmeCo",
				footer: "Footer text",
				unsubscribeUrl: "https://example.com/unsub",
			});

			const ltrHtml = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx({ locale: "en-US" })}>
					<div>CONTENT</div>
				</BaseEmailLayout>,
			);

			const rtlHtml = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx({ locale: "ar" })}>
					<div>CONTENT</div>
				</BaseEmailLayout>,
			);

			// Both should contain the same brand/content/footer
			expect(rtlHtml).toContain("AcmeCo");
			expect(rtlHtml).toContain("Footer text");
			expect(rtlHtml).toContain("CONTENT");
			expect(ltrHtml).toContain("AcmeCo");
			expect(ltrHtml).toContain("Footer text");
			expect(ltrHtml).toContain("CONTENT");

			// The only structural difference should be the dir attribute
			const ltrNormalized = ltrHtml.replace('dir="ltr"', 'dir="__DIR__"');
			const rtlNormalized = rtlHtml.replace('dir="rtl"', 'dir="__DIR__"');
			// lang attribute will also differ
			const ltrFinal = ltrNormalized.replace('lang="en"', 'lang="__LANG__"');
			const rtlFinal = rtlNormalized.replace('lang="ar"', 'lang="__LANG__"');
			expect(ltrFinal).toBe(rtlFinal);
		});
	});

	describe("CSS directional alignment — layout uses only direction-neutral properties", () => {
		// CSS logical properties (text-align:start/end, margin-inline-start, etc.) have ~31%
		// email client support and are NOT safe for cross-client use (Gmail, Outlook).
		// The correct approach is dir="rtl" on <Html> which handles mirroring automatically.
		// Physical left/right values must not appear in the layout — the layout only uses
		// direction-neutral "center" alignment, which works correctly in both LTR and RTL.
		it("should not use text-align:left in the rendered HTML", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).not.toMatch(/text-align:\s*left/);
		});

		it("should not use text-align:right in the rendered HTML", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).not.toMatch(/text-align:\s*right/);
		});

		it("should not use CSS logical properties (not safe for email clients)", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			// CSS logical properties have poor email client support — must not appear
			expect(html).not.toMatch(/text-align:\s*start/);
			expect(html).not.toMatch(/text-align:\s*end/);
			expect(html).not.toMatch(/margin-inline/);
			expect(html).not.toMatch(/padding-inline/);
		});
	});
});

// ---------------------------------------------------------------------------
// isRtl export — verify it is exported from the package index
// ---------------------------------------------------------------------------

describe("isRtl package export", () => {
	it("should be a function exported from the templates package index", () => {
		expect(typeof isRtl).toBe("function");
	});

	it("should return a boolean", () => {
		const result = isRtl("en");
		expect(typeof result).toBe("boolean");
	});
});
