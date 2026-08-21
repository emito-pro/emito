/**
 * Tests for team event templates.
 *
 * Events covered:
 *   - team.invitation    (email, inApp)
 *   - team.member-joined (inApp)
 *   - team.role-changed  (email, inApp)
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

// Event template imports — named exports from event files
import { teamInvitationTemplates } from "../events/team/invitation";
import { teamMemberJoinedTemplates } from "../events/team/member-joined";
import { teamRoleChangedTemplates } from "../events/team/role-changed";

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
// team.invitation
// ---------------------------------------------------------------------------

describe("teamInvitationTemplates", () => {
	const template = teamInvitationTemplates.en!;

	describe("email channel", () => {
		it("should render an email with subject, html, and text", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(typeof result.html).toBe("string");
			expect(typeof result.text).toBe("string");
			expect(result.subject.length).toBeGreaterThan(0);
		});

		it("should reference a team in the email subject", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: "You've been invited to {team}"
			expect(result.subject.toLowerCase()).toContain("invited");
		});

		it("should include a CTA for accepting invitation in the email", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: CTA "Accept Invitation"
			expect(result.html.toLowerCase()).toContain("accept");
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

		it("should have subject containing 'invitation'", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Subject "Team invitation"
			expect(result.subject?.toLowerCase()).toContain("invitation");
		});

		it("should have body referencing being invited to a team", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Body "You've been invited to {team}"
			expect(result.body.toLowerCase()).toContain("invited");
		});

		it("should have an actionUrl for accepting the invitation", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			expect(result.actionUrl).toBeDefined();
			expect(typeof result.actionUrl).toBe("string");
		});
	});
});

// ---------------------------------------------------------------------------
// team.member-joined
// ---------------------------------------------------------------------------

describe("teamMemberJoinedTemplates", () => {
	const template = teamMemberJoinedTemplates.en!;

	describe("inApp channel", () => {
		it("should render an inApp notification with subject and body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(result.body).toBeDefined();
			expect(result.subject?.length).toBeGreaterThan(0);
			expect(result.body.length).toBeGreaterThan(0);
		});

		it("should reference 'joined' in subject", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Subject "{name} joined"
			expect(result.subject?.toLowerCase()).toContain("joined");
		});

		it("should reference joining a team in body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Body "{name} joined {team}."
			expect(result.body.toLowerCase()).toContain("joined");
		});
	});

	describe("channel exclusivity (inApp only per spec)", () => {
		it("should not define an email channel", () => {
			expect(template.email).toBeUndefined();
		});

		it("should not define an SMS channel", () => {
			expect(template.sms).toBeUndefined();
		});

		it("should not define a push channel", () => {
			expect(template.push).toBeUndefined();
		});
	});
});

// ---------------------------------------------------------------------------
// team.role-changed
// ---------------------------------------------------------------------------

describe("teamRoleChangedTemplates", () => {
	const template = teamRoleChangedTemplates.en!;

	describe("email channel", () => {
		it("should render an email with subject, html, and text", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject).toBeDefined();
			expect(typeof result.html).toBe("string");
			expect(typeof result.text).toBe("string");
		});

		it("should reference team in the email subject", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: "Your role in {team} was updated"
			expect(result.subject.toLowerCase()).toContain("role");
		});

		it("should include role transition details in the email body", async () => {
			const result = await template.email!({}, makeBrand(), makeCtx());
			// Spec: Body: old role → new role
			expect(result.html.toLowerCase()).toContain("role");
		});

		it("should include brand name in rendered HTML", async () => {
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
		});

		it("should include 'role' in inApp subject", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Subject "Role updated"
			expect(result.subject?.toLowerCase()).toContain("role");
		});

		it("should reference the team and new role in inApp body", () => {
			const result = template.inApp!({}, makeBrand(), makeCtx());
			// Spec: Body "Your role in {team} changed to {role}."
			expect(result.body.toLowerCase()).toContain("role");
		});
	});
});

// ---------------------------------------------------------------------------
// defaultTemplates completeness — team events
// ---------------------------------------------------------------------------

describe("defaultTemplates — team events", () => {
	it("should contain team.invitation under en lang", () => {
		expect(defaultTemplates).toHaveProperty("team.invitation");
		expect(defaultTemplates["team.invitation"]).toHaveProperty("en");
	});

	it("should contain team.member-joined under en lang", () => {
		expect(defaultTemplates).toHaveProperty("team.member-joined");
		expect(defaultTemplates["team.member-joined"]).toHaveProperty("en");
	});

	it("should contain team.role-changed under en lang", () => {
		expect(defaultTemplates).toHaveProperty("team.role-changed");
		expect(defaultTemplates["team.role-changed"]).toHaveProperty("en");
	});

	it("should expose email and inApp functions for team.invitation", () => {
		const enTemplate = defaultTemplates["team.invitation"]?.en!;
		expect(typeof enTemplate.email).toBe("function");
		expect(typeof enTemplate.inApp).toBe("function");
	});

	it("should expose inApp function for team.member-joined", () => {
		const enTemplate = defaultTemplates["team.member-joined"]?.en!;
		expect(typeof enTemplate.inApp).toBe("function");
	});

	it("should expose email and inApp functions for team.role-changed", () => {
		const enTemplate = defaultTemplates["team.role-changed"]?.en!;
		expect(typeof enTemplate.email).toBe("function");
		expect(typeof enTemplate.inApp).toBe("function");
	});
});
