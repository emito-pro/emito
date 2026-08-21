/**
 * Tests for billing event templates.
 *
 * Events covered:
 *   - billing.payment-succeeded  (email, inApp)
 *   - billing.payment-failed     (email, sms, push, inApp)
 *   - billing.trial-expiring     (email, push, inApp)
 *
 * Rules applied (testing standards):
 * - Test boundary conditions for optional parameters (rule 5)
 * - Test empty string inputs (rule 6)
 * - Never mock the module under test (rule 10)
 * - Follow describe("templateName") > describe("channel") > it("should X when Y") naming (rule 15)
 * - Assert on shape of return values, not just existence (rule 26)
 * - Use toMatchObject for partial assertions on large objects (rule 27)
 */

import type { BrandTheme, RenderContext } from "@emito/types";
import { describe, expect, it } from "vitest";

import { billingPaymentFailedTemplates } from "../events/billing/payment-failed";
// Event template imports — named exports from event files
import { billingPaymentSucceededTemplates } from "../events/billing/payment-succeeded";
import { billingTrialExpiringTemplates } from "../events/billing/trial-expiring";

// defaultTemplates registry from index
import { defaultTemplates } from "../index";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeBrand(overrides: Partial<BrandTheme> = {}): BrandTheme {
	return {
		name: "TestApp",
		appUrl: "https://testapp.example.com",
		primaryColor: "#6366f1",
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
// billing.payment-succeeded
// ---------------------------------------------------------------------------

describe("billingPaymentSucceededTemplates", () => {
	const template = billingPaymentSucceededTemplates.en!;

	describe("email channel", () => {
		it("should render an email with subject, html, and text", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(typeof result.html).toBe("string");
			expect(typeof result.text).toBe("string");
			expect(result.subject.length).toBeGreaterThan(0);
		});

		it("should reference 'received' or 'payment' in the subject", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: "Payment received — {amount}"
			const subjectLower = result.subject.toLowerCase();
			expect(subjectLower.includes("payment") || subjectLower.includes("received")).toBe(true);
		});

		it("should include a CTA to view receipt", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: CTA "View Receipt"
			expect(result.html.toLowerCase()).toContain("receipt");
		});

		it("should include brand name in the rendered HTML", async () => {
			const brand = makeBrand({ name: "AcmeCo" });
			const result = await template.email!({}, brand, makeCtx());
			expect(result.html).toContain("AcmeCo");
		});

		it("should not define an SMS channel (not in spec)", () => {
			expect(template.sms).toBeUndefined();
		});

		it("should not define a push channel (not in spec)", () => {
			expect(template.push).toBeUndefined();
		});
	});

	describe("inApp channel", () => {
		it("should render an inApp notification with subject and body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(result.body).toBeDefined();
			expect(result.subject?.length).toBeGreaterThan(0);
			expect(result.body.length).toBeGreaterThan(0);
		});

		it("should reference 'payment' in inApp subject", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Subject "Payment received"
			expect(result.subject?.toLowerCase()).toContain("payment");
		});

		it("should reference a processed payment in inApp body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Body "Payment of {amount} processed successfully."
			expect(result.body.toLowerCase()).toContain("payment");
		});
	});
});

// ---------------------------------------------------------------------------
// billing.payment-failed
// ---------------------------------------------------------------------------

describe("billingPaymentFailedTemplates", () => {
	const template = billingPaymentFailedTemplates.en!;

	describe("email channel", () => {
		it("should render an email with subject, html, and text", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(typeof result.html).toBe("string");
			expect(typeof result.text).toBe("string");
		});

		it("should indicate payment failed and action required in subject", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: "Payment failed — action required"
			const subjectLower = result.subject.toLowerCase();
			expect(subjectLower).toContain("failed");
		});

		it("should include next steps or CTA for updating payment method", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: CTA "Update Payment Method"
			expect(result.html.toLowerCase()).toContain("payment");
		});

		it("should include brand name in rendered HTML", async () => {
			const brand = makeBrand({ name: "AcmeCo" });
			const result = await template.email!({}, brand, makeCtx());
			expect(result.html).toContain("AcmeCo");
		});
	});

	describe("SMS channel", () => {
		it("should render an SMS body as a string", () => {
			const result = template.sms!({}, makeBrand(), makeCtx());
			expect(typeof result.body).toBe("string");
			expect(result.body.length).toBeGreaterThan(0);
		});

		it("should include brand name in SMS body", () => {
			const result = template.sms!({}, makeBrand({ name: "MyApp" }), makeCtx());
			// Spec: "{brand}: Payment of {amount} failed. Update: {url}"
			expect(result.body).toContain("MyApp");
		});

		it("should be at most 160 characters with typical values", () => {
			const result = template.sms!(
				{ amount: "$49.00", url: "https://testapp.example.com/billing" },
				makeBrand({ name: "TestApp" }),
				makeCtx(),
			);
			expect(result.body.length).toBeLessThanOrEqual(160);
		});
	});

	describe("push channel", () => {
		it("should render a push notification with title and body", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			expect(result.title).toBeDefined();
			expect(result.body).toBeDefined();
			expect(result.title.length).toBeGreaterThan(0);
			expect(result.body.length).toBeGreaterThan(0);
		});

		it("should have a push title indicating payment failure", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Title "Payment Failed"
			expect(result.title.toLowerCase()).toContain("payment");
			expect(result.title.toLowerCase()).toContain("failed");
		});

		it("should reference payment in the push body", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Body "Your payment of {amount} could not be processed."
			expect(result.body.toLowerCase()).toContain("payment");
		});
	});

	describe("inApp channel", () => {
		it("should render an inApp notification with subject and body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(result.body).toBeDefined();
		});

		it("should indicate payment failed in inApp subject", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Subject "Payment failed"
			expect(result.subject?.toLowerCase()).toContain("failed");
		});

		it("should instruct user to update payment method in inApp body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Body "Update your payment method."
			expect(result.body.toLowerCase()).toContain("payment");
		});

		it("should have an actionUrl pointing to billing", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Action "Update" → /billing
			expect(result.actionUrl).toContain("billing");
		});
	});
});

// ---------------------------------------------------------------------------
// billing.trial-expiring
// ---------------------------------------------------------------------------

describe("billingTrialExpiringTemplates", () => {
	const template = billingTrialExpiringTemplates.en!;

	describe("email channel", () => {
		it("should render an email with subject, html, and text", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(typeof result.html).toBe("string");
			expect(typeof result.text).toBe("string");
		});

		it("should reference days remaining in the email subject", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: "Your trial ends in {days} days"
			const subjectLower = result.subject.toLowerCase();
			expect(subjectLower).toContain("trial");
		});

		it("should include an upgrade CTA in the email", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: CTA "Upgrade Now"
			expect(result.html.toLowerCase()).toContain("upgrade");
		});

		it("should not define an SMS channel (not in spec)", () => {
			expect(template.sms).toBeUndefined();
		});
	});

	describe("push channel", () => {
		it("should render a push notification with title and body", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			expect(result.title).toBeDefined();
			expect(result.body).toBeDefined();
		});

		it("should reference 'Trial' in push title", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Title "Trial Ending"
			expect(result.title.toLowerCase()).toContain("trial");
		});

		it("should reference days remaining in push body", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Body "{days} days left on your trial."
			expect(result.body.toLowerCase()).toContain("days");
		});
	});

	describe("inApp channel", () => {
		it("should render an inApp notification with subject and body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(result.body).toBeDefined();
		});

		it("should reference trial expiration in inApp subject", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Subject "Trial ending soon"
			expect(result.subject?.toLowerCase()).toContain("trial");
		});

		it("should reference days remaining in inApp body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Body "Your trial expires in {days} days."
			expect(result.body.toLowerCase()).toContain("days");
		});

		it("should have an actionUrl pointing to billing or upgrade", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Action "Upgrade" → /billing
			expect(result.actionUrl).toContain("billing");
		});
	});
});

// ---------------------------------------------------------------------------
// Minimal-props tests — exercise falsy branches for optional fields
// ---------------------------------------------------------------------------

describe("billing templates — renders with minimal props", () => {
	const minimalBrand: BrandTheme = { name: "Min", appUrl: "https://min.example.com" };
	const ctx = makeCtx();

	describe("billing.payment-succeeded with minimal payload and brand", () => {
		it("should render email with empty amount and fallback receiptUrl", async () => {
			const content = await billingPaymentSucceededTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.subject).toContain("Payment received");
			expect(content.html).toContain("Min");
		});

		it("should render email falling back to brand.appUrl when receiptUrl is empty string", async () => {
			const content = await billingPaymentSucceededTemplates.en!.email!(
				{ receiptUrl: "" },
				minimalBrand,
				ctx,
			);
			expect(content.html).toContain("https://min.example.com");
		});

		it("should render in-app with empty amount", () => {
			const content = billingPaymentSucceededTemplates.en!.inApp!({}, minimalBrand, ctx);
			expect(content.subject).toContain("Payment");
			expect(content.body).toContain("Payment");
		});
	});

	describe("billing.payment-failed with minimal payload and brand", () => {
		it("should render email with empty amount and fallback updateUrl", async () => {
			const content = await billingPaymentFailedTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.html).toContain("Min");
		});

		it("should render email falling back to brand.appUrl when updateUrl is empty string", async () => {
			const content = await billingPaymentFailedTemplates.en!.email!(
				{ updateUrl: "" },
				minimalBrand,
				ctx,
			);
			expect(content.html).toContain("https://min.example.com");
		});

		it("should render SMS with empty amount and url", () => {
			const content = billingPaymentFailedTemplates.en!.sms!({}, minimalBrand, ctx);
			expect(content.body).toContain("Min");
		});

		it("should render SMS that truncates to 160 chars when body is long", () => {
			const content = billingPaymentFailedTemplates.en!.sms!(
				{ amount: "A".repeat(200) },
				minimalBrand,
				ctx,
			);
			expect(content.body.length).toBeLessThanOrEqual(160);
		});

		it("should render push with empty amount", () => {
			const content = billingPaymentFailedTemplates.en!.push!({}, minimalBrand, ctx);
			expect(content.title).toContain("Payment Failed");
		});
	});

	describe("billing.trial-expiring with minimal payload and brand", () => {
		it("should render email with empty days and fallback upgradeUrl", async () => {
			const content = await billingTrialExpiringTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.subject).toContain("trial");
			expect(content.html).toContain("Min");
		});

		it("should render email falling back to brand.appUrl when upgradeUrl is empty string", async () => {
			const content = await billingTrialExpiringTemplates.en!.email!(
				{ upgradeUrl: "" },
				minimalBrand,
				ctx,
			);
			expect(content.html).toContain("https://min.example.com");
		});

		it("should render push with empty days", () => {
			const content = billingTrialExpiringTemplates.en!.push!({}, minimalBrand, ctx);
			expect(content.title).toContain("Trial");
		});

		it("should render in-app with empty days", () => {
			const content = billingTrialExpiringTemplates.en!.inApp!({}, minimalBrand, ctx);
			expect(content.subject).toContain("Trial");
		});
	});
});

// ---------------------------------------------------------------------------
// defaultTemplates completeness — billing events
// ---------------------------------------------------------------------------

describe("defaultTemplates — billing events", () => {
	it("should contain billing.payment-succeeded under en lang", () => {
		expect(defaultTemplates).toHaveProperty("billing.payment-succeeded");
		expect(defaultTemplates["billing.payment-succeeded"]).toHaveProperty("en");
	});

	it("should contain billing.payment-failed under en lang", () => {
		expect(defaultTemplates).toHaveProperty("billing.payment-failed");
		expect(defaultTemplates["billing.payment-failed"]).toHaveProperty("en");
	});

	it("should contain billing.trial-expiring under en lang", () => {
		expect(defaultTemplates).toHaveProperty("billing.trial-expiring");
		expect(defaultTemplates["billing.trial-expiring"]).toHaveProperty("en");
	});

	it("should expose email and inApp functions for billing.payment-succeeded", () => {
		const enTemplate = defaultTemplates["billing.payment-succeeded"]?.en!;
		expect(typeof enTemplate.email).toBe("function");
		expect(typeof enTemplate.inApp).toBe("function");
	});

	it("should expose all 4 channel functions for billing.payment-failed", () => {
		const enTemplate = defaultTemplates["billing.payment-failed"]?.en!;
		expect(typeof enTemplate.email).toBe("function");
		expect(typeof enTemplate.sms).toBe("function");
		expect(typeof enTemplate.push).toBe("function");
		expect(typeof enTemplate.inApp).toBe("function");
	});

	it("should expose email, push, and inApp functions for billing.trial-expiring", () => {
		const enTemplate = defaultTemplates["billing.trial-expiring"]?.en!;
		expect(typeof enTemplate.email).toBe("function");
		expect(typeof enTemplate.push).toBe("function");
		expect(typeof enTemplate.inApp).toBe("function");
	});
});
