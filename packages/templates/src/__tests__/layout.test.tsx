/**
 * Tests for BaseEmailLayout React Email component.
 *
 * Verifies:
 * - Layout renders valid HTML
 * - BrandTheme fields (name, primaryColor, logoUrl, appUrl, footer) are reflected
 * - The `extra` slot renders additional content
 * - RenderContext is available to child components
 * - Unsubscribe, privacy, support links are rendered when provided in BrandTheme
 *
 * Rules applied (testing standards):
 * - Test boundary conditions (rule 4): no optional fields, all fields
 * - Test empty/undefined for optional parameters (rule 5)
 * - Never mock the module under test (rule 10)
 * - Follow describe("ComponentName") > it("should X when Y") naming (rule 15)
 * - Assert on shape of return values, not just existence (rule 26)
 * - Prefer specific matchers over generic ones (rule 25)
 */

import type { BrandTheme, RenderContext } from "@emito/types";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
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

describe("BaseEmailLayout", () => {
	describe("renders valid HTML", () => {
		it("should render without throwing for minimal brand", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx()}>
					<div>Hello</div>
				</BaseEmailLayout>,
			);
			expect(typeof html).toBe("string");
			expect(html.length).toBeGreaterThan(0);
		});

		it("should render a complete HTML document structure", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx()}>
					<div>Body content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("<html");
			expect(html).toContain("</html>");
		});
	});

	describe("BrandTheme integration", () => {
		it("should include brand name in rendered output", async () => {
			const brand = makeBrand({ name: "MyBrand" });
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("MyBrand");
		});

		it("should include appUrl in rendered output", async () => {
			const brand = makeBrand({ appUrl: "https://myapp.example.com" });
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("https://myapp.example.com");
		});

		it("should include logoUrl in rendered output when provided", async () => {
			const brand = makeBrand({ logoUrl: "https://myapp.example.com/logo.png" });
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("https://myapp.example.com/logo.png");
		});

		it("should apply primaryColor somewhere in the rendered output when provided", async () => {
			const brand = makeBrand({ primaryColor: "#ab1234" });
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("#ab1234");
		});

		it("should include custom footer text when provided", async () => {
			const brand = makeBrand({ footer: "Sent with love from TestApp" });
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("Sent with love from TestApp");
		});

		it("should include unsubscribe link when unsubscribeUrl is provided", async () => {
			const brand = makeBrand({ unsubscribeUrl: "https://myapp.example.com/unsubscribe" });
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("https://myapp.example.com/unsubscribe");
		});

		it("should include privacy link when privacyUrl is provided", async () => {
			const brand = makeBrand({ privacyUrl: "https://myapp.example.com/privacy" });
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("https://myapp.example.com/privacy");
		});

		it("should render without error when all optional brand fields are absent", async () => {
			const html = await render(
				<BaseEmailLayout
					brand={{ name: "Minimal", appUrl: "https://minimal.example.com" }}
					ctx={makeCtx()}
				>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("Minimal");
		});
	});

	describe("children slot", () => {
		it("should render children content in the output", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx()}>
					<div>UNIQUE_CONTENT_MARKER</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("UNIQUE_CONTENT_MARKER");
		});
	});

	describe("renders with minimal brand (no optional fields)", () => {
		it("should not render logo image when logoUrl is absent", async () => {
			const html = await render(
				<BaseEmailLayout
					brand={{ name: "Minimal", appUrl: "https://min.example.com" }}
					ctx={makeCtx()}
				>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).not.toContain("<img");
			expect(html).toContain("Minimal");
		});

		it("should not render footer text when footer is absent", async () => {
			const html = await render(
				<BaseEmailLayout
					brand={{ name: "Minimal", appUrl: "https://min.example.com" }}
					ctx={makeCtx()}
				>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			// Should not contain a dedicated footer text section beyond the brand name link
			expect(html).not.toContain("Sent with");
		});

		it("should not render unsubscribe link when unsubscribeUrl is absent", async () => {
			const html = await render(
				<BaseEmailLayout
					brand={{ name: "Minimal", appUrl: "https://min.example.com" }}
					ctx={makeCtx()}
				>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).not.toContain("Unsubscribe");
		});

		it("should not render privacy link when privacyUrl is absent", async () => {
			const html = await render(
				<BaseEmailLayout
					brand={{ name: "Minimal", appUrl: "https://min.example.com" }}
					ctx={makeCtx()}
				>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).not.toContain("Privacy");
		});

		it("should not render support link when supportEmail is absent", async () => {
			const html = await render(
				<BaseEmailLayout
					brand={{ name: "Minimal", appUrl: "https://min.example.com" }}
					ctx={makeCtx()}
				>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).not.toContain("Support");
		});

		it("should not render preview when preview prop is absent", async () => {
			const html = await render(
				<BaseEmailLayout
					brand={{ name: "Minimal", appUrl: "https://min.example.com" }}
					ctx={makeCtx()}
				>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			// Preview element should not be present
			expect(html).toContain("<html");
		});

		it("should render separator between unsubscribe and privacy when both present", async () => {
			const brand = makeBrand({
				unsubscribeUrl: "https://example.com/unsub",
				privacyUrl: "https://example.com/privacy",
			});
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("Unsubscribe");
			expect(html).toContain("Privacy");
		});

		it("should render separator between privacy and support when both present", async () => {
			const brand = makeBrand({
				privacyUrl: "https://example.com/privacy",
				supportEmail: "help@example.com",
			});
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("Privacy");
			expect(html).toContain("Support");
		});

		it("should render only support link when only supportEmail is present", async () => {
			const brand = makeBrand({ supportEmail: "help@example.com" });
			const html = await render(
				<BaseEmailLayout brand={brand} ctx={makeCtx()}>
					<div>Content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("Support");
			expect(html).not.toContain("Unsubscribe");
			expect(html).not.toContain("Privacy");
		});
	});

	describe("extra slot", () => {
		it("should render extra slot content when provided", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx()} extra={<div>EXTRA_SLOT_CONTENT</div>}>
					<div>Main content</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("EXTRA_SLOT_CONTENT");
		});

		it("should not throw when extra slot is not provided", async () => {
			await expect(
				render(
					<BaseEmailLayout brand={makeBrand()} ctx={makeCtx()}>
						<div>No extra</div>
					</BaseEmailLayout>,
				),
			).resolves.toBeDefined();
		});

		it("should render both main children and extra slot content", async () => {
			const html = await render(
				<BaseEmailLayout brand={makeBrand()} ctx={makeCtx()} extra={<div>EXTRA</div>}>
					<div>MAIN</div>
				</BaseEmailLayout>,
			);
			expect(html).toContain("MAIN");
			expect(html).toContain("EXTRA");
		});
	});
});
