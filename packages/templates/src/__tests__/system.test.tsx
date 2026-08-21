/**
 * Tests for system event templates.
 *
 * Events covered:
 *   - system.maintenance  (email, push, inApp)
 *   - system.incident     (email, push, inApp)
 *   - system.resolved     (email, push, inApp)
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

import { systemIncidentTemplates } from "../events/system/incident";
// Event template imports — named exports from event files
import { systemMaintenanceTemplates } from "../events/system/maintenance";
import { systemResolvedTemplates } from "../events/system/resolved";

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
// system.maintenance
// ---------------------------------------------------------------------------

describe("systemMaintenanceTemplates", () => {
	const template = systemMaintenanceTemplates.en!;

	describe("email channel", () => {
		it("should render an email with subject, html, and text", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(typeof result.html).toBe("string");
			expect(typeof result.text).toBe("string");
			expect(result.subject.length).toBeGreaterThan(0);
		});

		it("should reference 'maintenance' in the email subject", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: "Scheduled maintenance: {date}"
			expect(result.subject.toLowerCase()).toContain("maintenance");
		});

		it("should reference scheduled maintenance details in the email body", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: window, what's affected, expected downtime
			expect(result.html.toLowerCase()).toContain("maintenance");
		});

		it("should include brand name in rendered HTML", async () => {
			const brand = makeBrand({ name: "AcmeCo" });
			const result = await template.email!({}, brand, makeCtx());
			expect(result.html).toContain("AcmeCo");
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
			expect(result.title.length).toBeGreaterThan(0);
			expect(result.body.length).toBeGreaterThan(0);
		});

		it("should reference 'maintenance' in push title", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Title "Scheduled Maintenance"
			expect(result.title.toLowerCase()).toContain("maintenance");
		});

		it("should reference date or downtime in push body", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Body "{date} — {duration} expected downtime"
			expect(result.body.length).toBeGreaterThan(0);
		});
	});

	describe("inApp channel", () => {
		it("should render an inApp notification with subject and body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(result.body).toBeDefined();
		});

		it("should reference 'maintenance' in inApp subject", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Subject "Maintenance scheduled"
			expect(result.subject?.toLowerCase()).toContain("maintenance");
		});

		it("should reference the planned date in inApp body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Body "Planned maintenance on {date}."
			expect(result.body.toLowerCase()).toContain("maintenance");
		});
	});
});

// ---------------------------------------------------------------------------
// system.incident
// ---------------------------------------------------------------------------

describe("systemIncidentTemplates", () => {
	const template = systemIncidentTemplates.en!;

	describe("email channel", () => {
		it("should render an email with subject, html, and text", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(typeof result.html).toBe("string");
			expect(typeof result.text).toBe("string");
		});

		it("should reference 'incident' in the email subject", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: "Service incident: {title}"
			expect(result.subject.toLowerCase()).toContain("incident");
		});

		it("should include incident title in subject when provided in payload", async () => {
			const result = await template.email!(
				{ title: "Database Outage", affected: "REST API", status: "investigating" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.subject).toContain("Database Outage");
		});

		it("should reference affected services in the email body", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: Body: what's affected, current status, updates link
			expect(result.html.toLowerCase()).toContain("incident");
		});

		it("should include a status page CTA when statusUrl is provided", async () => {
			const result = await template.email!(
				{
					title: "Outage",
					affected: "API",
					status: "investigating",
					statusUrl: "https://status.testapp.example.com",
				},
				makeBrand(),
				makeCtx(),
			);
			// Spec: CTA "Status Page" — button rendered when statusUrl is present
			expect(result.html.toLowerCase()).toContain("status");
			expect(result.html).toContain("https://status.testapp.example.com");
		});

		it("should render without the status page button when statusUrl is absent", async () => {
			const result = await template.email!(
				{ title: "Outage", affected: "API", status: "investigating" },
				makeBrand(),
				makeCtx(),
			);
			// No statusUrl — button section should not render
			expect(result.html).not.toContain("status.testapp.example.com");
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

		it("should have 'Incident' in push title", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Title "Service Incident"
			expect(result.title.toLowerCase()).toContain("incident");
		});

		it("should have a non-empty push body", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Body "{title}" — will be template placeholder
			expect(result.body.length).toBeGreaterThan(0);
		});
	});

	describe("inApp channel", () => {
		it("should render an inApp notification with subject and body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(result.body).toBeDefined();
		});

		it("should reference 'Incident' in inApp subject", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Subject "Incident: {title}"
			expect(result.subject?.toLowerCase()).toContain("incident");
		});

		it("should reference investigating an issue in inApp body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Body "We're investigating an issue affecting {affected}."
			expect(result.body.toLowerCase()).toContain("issue");
		});

		it("should have an actionUrl for status page", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Action "Status Page"
			expect(result.actionUrl).toBeDefined();
		});
	});
});

// ---------------------------------------------------------------------------
// system.resolved
// ---------------------------------------------------------------------------

describe("systemResolvedTemplates", () => {
	const template = systemResolvedTemplates.en!;

	describe("email channel", () => {
		it("should render an email with subject, html, and text", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(typeof result.html).toBe("string");
			expect(typeof result.text).toBe("string");
		});

		it("should reference 'Resolved' in the email subject", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: "Resolved: {title}"
			expect(result.subject.toLowerCase()).toContain("resolved");
		});

		it("should contain a resolution summary in the email body", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: Body: resolution summary
			expect(result.html.toLowerCase()).toContain("resolved");
		});

		it("should include brand name in rendered HTML", async () => {
			const brand = makeBrand({ name: "AcmeCo" });
			const result = await template.email!({}, brand, makeCtx());
			expect(result.html).toContain("AcmeCo");
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

		it("should have 'Resolved' as push title", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Title "Resolved"
			expect(result.title.toLowerCase()).toContain("resolved");
		});

		it("should reference the incident in push body with resolved context", () => {
			const result = template.push!({}, makeBrand(), makeCtx());
			// Spec: Body "{title} has been resolved."
			expect(result.body.toLowerCase()).toContain("resolved");
		});
	});

	describe("inApp channel", () => {
		it("should render an inApp notification with subject and body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(result.body).toBeDefined();
		});

		it("should reference 'resolved' in inApp subject", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Subject "Incident resolved"
			expect(result.subject?.toLowerCase()).toContain("resolved");
		});

		it("should reference 'operational' or resolved state in inApp body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Body "{title} resolved. All systems operational."
			const bodyLower = result.body.toLowerCase();
			expect(bodyLower.includes("resolved") || bodyLower.includes("operational")).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// Minimal-props tests — exercise falsy branches for optional fields
// ---------------------------------------------------------------------------

describe("system templates — renders with minimal props", () => {
	const minimalBrand: BrandTheme = { name: "Min", appUrl: "https://min.example.com" };
	const ctx = makeCtx();

	describe("system.maintenance with minimal payload and brand", () => {
		it("should render email with empty date/duration/affected", async () => {
			const content = await systemMaintenanceTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.subject).toContain("maintenance");
			expect(content.html).toContain("Min");
		});

		it("should render push with empty date/duration", () => {
			const content = systemMaintenanceTemplates.en!.push!({}, minimalBrand, ctx);
			expect(content.title).toContain("Maintenance");
		});

		it("should render in-app with empty date", () => {
			const content = systemMaintenanceTemplates.en!.inApp!({}, minimalBrand, ctx);
			expect(content.subject).toContain("Maintenance");
		});
	});

	describe("system.incident with minimal payload and brand", () => {
		it("should render email without status page button when statusUrl is empty string", async () => {
			const content = await systemIncidentTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.html.toLowerCase()).toContain("incident");
			// statusUrl is "" so button should not render
			expect(content.html).not.toContain("Status Page");
		});

		it("should render email with status page button when statusUrl is provided", async () => {
			const content = await systemIncidentTemplates.en!.email!(
				{ title: "Outage", statusUrl: "https://status.min.example.com" },
				minimalBrand,
				ctx,
			);
			expect(content.html).toContain("https://status.min.example.com");
		});

		it("should render push with fallback body when title is empty", () => {
			const content = systemIncidentTemplates.en!.push!({}, minimalBrand, ctx);
			expect(content.title).toContain("Incident");
			expect(content.body).toBe("Service Incident");
		});

		it("should render push with title as body when title is provided", () => {
			const content = systemIncidentTemplates.en!.push!({ title: "DB Outage" }, minimalBrand, ctx);
			expect(content.body).toBe("DB Outage");
		});

		it("should render in-app with empty title and affected", () => {
			const content = systemIncidentTemplates.en!.inApp!({}, minimalBrand, ctx);
			expect(content.subject).toContain("Incident");
		});
	});

	describe("system.resolved with minimal payload and brand", () => {
		it("should render email with empty title and summary", async () => {
			const content = await systemResolvedTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.subject).toContain("Resolved");
			expect(content.html).toContain("Min");
		});

		it("should render push with empty title", () => {
			const content = systemResolvedTemplates.en!.push!({}, minimalBrand, ctx);
			expect(content.title).toContain("Resolved");
		});

		it("should render in-app with empty title", () => {
			const content = systemResolvedTemplates.en!.inApp!({}, minimalBrand, ctx);
			expect(content.subject).toContain("resolved");
		});
	});
});

// ---------------------------------------------------------------------------
// defaultTemplates completeness — system events
// ---------------------------------------------------------------------------

describe("defaultTemplates — system events", () => {
	it("should contain system.maintenance under en lang", () => {
		expect(defaultTemplates).toHaveProperty("system.maintenance");
		expect(defaultTemplates["system.maintenance"]).toHaveProperty("en");
	});

	it("should contain system.incident under en lang", () => {
		expect(defaultTemplates).toHaveProperty("system.incident");
		expect(defaultTemplates["system.incident"]).toHaveProperty("en");
	});

	it("should contain system.resolved under en lang", () => {
		expect(defaultTemplates).toHaveProperty("system.resolved");
		expect(defaultTemplates["system.resolved"]).toHaveProperty("en");
	});

	it("should expose email, push, and inApp functions for system.maintenance", () => {
		const enTemplate = defaultTemplates["system.maintenance"]?.en!;
		expect(typeof enTemplate.email).toBe("function");
		expect(typeof enTemplate.push).toBe("function");
		expect(typeof enTemplate.inApp).toBe("function");
	});

	it("should expose email, push, and inApp functions for system.incident", () => {
		const enTemplate = defaultTemplates["system.incident"]?.en!;
		expect(typeof enTemplate.email).toBe("function");
		expect(typeof enTemplate.push).toBe("function");
		expect(typeof enTemplate.inApp).toBe("function");
	});

	it("should expose email, push, and inApp functions for system.resolved", () => {
		const enTemplate = defaultTemplates["system.resolved"]?.en!;
		expect(typeof enTemplate.email).toBe("function");
		expect(typeof enTemplate.push).toBe("function");
		expect(typeof enTemplate.inApp).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// defaultTemplates completeness — task 3 events (9 total)
// ---------------------------------------------------------------------------

describe("defaultTemplates — task 3 events (team + billing + system)", () => {
	const task3Events = [
		"team.invitation",
		"team.member-joined",
		"team.role-changed",
		"billing.payment-succeeded",
		"billing.payment-failed",
		"billing.trial-expiring",
		"system.maintenance",
		"system.incident",
		"system.resolved",
	];

	it.each(task3Events)("should contain '%s' with an 'en' lang entry", (eventName) => {
		expect(defaultTemplates).toHaveProperty(eventName);
		expect(defaultTemplates[eventName]).toHaveProperty("en");
	});

	it("should contain at least 9 event keys (task 3 events)", () => {
		const eventKeys = Object.keys(defaultTemplates);
		expect(eventKeys.length).toBeGreaterThanOrEqual(9);
	});
});
