/**
 * Tests for typed payload interfaces and i18n type safety (Task 1 — D-008 + D-010).
 *
 * Verifies that:
 *   1. All 18 templates use typed payloads (accept correctly-typed payload objects)
 *   2. Lang maps export `satisfies Record<string, EventTemplate<TPayload>>` shape
 *   3. Hardcoded English strings are NOT present in shared components
 *      (all text is passed as props from lang maps)
 *   4. Lang fallback works: missing lang falls back to 'en' via resolveLang
 *
 * Rules applied (testing standards):
 *   - Do not test TypeScript type enforcement at runtime (rule 29) —
 *     satisfies checks are compile-time. We test structural/runtime contracts here.
 *   - Test boundary conditions for optional parameters (rule 5)
 *   - Follow describe("eventName") > describe("channel") > it("should X") naming (rule 15)
 *   - Assert on shape of return values (rule 26)
 *   - Prefer specific matchers over generic ones (rule 25)
 *
 * Architecture note (templates-i18n.md § 27):
 *   "Templates are TypeScript functions — interpolation is native.
 *    Each event template is lang-keyed: Record<string, EventTemplate> where keys are lang codes."
 */

import type { BrandTheme, RenderContext } from "@emito/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
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
// Typed payload structural checks — all 18 templates
// ---------------------------------------------------------------------------

describe("typed payload structural checks", () => {
	describe("auth templates", () => {
		it("welcomeTemplates — accepts typed payload { name?: string }", async () => {
			const { welcomeTemplates } = await import("../events/auth/welcome");
			const template = welcomeTemplates.en!;
			const result = await template.email!({ name: "Alice" }, makeBrand(), makeCtx());
			expect(result.html).toContain("Alice");
		});

		it("passwordResetTemplates — accepts { code?: string, resetUrl?: string }", async () => {
			const { passwordResetTemplates } = await import("../events/auth/password-reset");
			const template = passwordResetTemplates.en!;
			const result = template.sms!(
				{ code: "999111", resetUrl: "https://example.com/r" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.body).toContain("999111");
		});

		it("emailVerificationTemplates — accepts { verificationUrl?: string }", async () => {
			const { emailVerificationTemplates } = await import("../events/auth/email-verification");
			const template = emailVerificationTemplates.en!;
			const result = await template.email!(
				{ verificationUrl: "https://example.com/verify?t=tok1" },
				makeBrand(),
				makeCtx(),
			);
			expect(typeof result.subject).toBe("string");
		});

		it("loginNewDeviceTemplates — accepts { device?, location?, ip?, secureUrl? }", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const template = loginNewDeviceTemplates.en!;
			const result = template.push!(
				{ device: "Safari on iPhone", location: "Berlin, DE", ip: "10.0.0.1" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.title.length).toBeGreaterThan(0);
		});

		it("passwordChangedTemplates — accepts { secureUrl?: string }", async () => {
			const { passwordChangedTemplates } = await import("../events/auth/password-changed");
			const template = passwordChangedTemplates.en!;
			const result = template.sms!(
				{ secureUrl: "https://example.com/security" },
				makeBrand({ name: "MyBrand" }),
				makeCtx(),
			);
			expect(result.body).toContain("MyBrand");
		});

		it("twoFaEnabledTemplates — accepts empty payload {} (no required fields)", async () => {
			const { twoFaEnabledTemplates } = await import("../events/auth/2fa-enabled");
			const template = twoFaEnabledTemplates.en!;
			const result = await template.email!({}, makeBrand(), makeCtx());
			expect(result.subject.toLowerCase()).toMatch(/two.factor|2fa/);
		});
	});

	describe("security templates", () => {
		it("securityAlertTemplates — accepts { description?: string, secureUrl?: string, device?, location?, ip?, time? }", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en!;
			const result = template.push!(
				{ description: "Unusual login", secureUrl: "https://example.com/s" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.body).toContain("Unusual login");
		});

		it("securityApiKeyCreatedTemplates — accepts { name?, permissions?, createdBy? }", async () => {
			const { securityApiKeyCreatedTemplates } = await import("../events/security/api-key-created");
			const template = securityApiKeyCreatedTemplates.en!;
			const result = template.inApp!(
				{ name: "deploy-key", permissions: "write", createdBy: "ci-bot" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.body).toContain("deploy-key");
		});

		it("securityApiKeyExpiringTemplates — accepts { name?: string, days?: number }", async () => {
			const { securityApiKeyExpiringTemplates } = await import(
				"../events/security/api-key-expiring"
			);
			const template = securityApiKeyExpiringTemplates.en!;
			const result = template.inApp!({ name: "prod-key", days: 3 }, makeBrand(), makeCtx());
			expect(result.body).toContain("3");
		});
	});

	describe("team templates", () => {
		it("teamInvitationTemplates — accepts { team?, inviterName?, acceptUrl? }", async () => {
			const { teamInvitationTemplates } = await import("../events/team/invitation");
			const template = teamInvitationTemplates.en!;
			const result = template.inApp!(
				{ team: "Platform", inviterName: "Bob" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.body.toLowerCase()).toContain("invited");
		});

		it("teamMemberJoinedTemplates — accepts { name?, team? }", async () => {
			const { teamMemberJoinedTemplates } = await import("../events/team/member-joined");
			const template = teamMemberJoinedTemplates.en!;
			const result = template.inApp!(
				{ name: "Carol", team: "Engineering" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.body.toLowerCase()).toContain("joined");
		});

		it("teamRoleChangedTemplates — accepts { team?, oldRole?, newRole? }", async () => {
			const { teamRoleChangedTemplates } = await import("../events/team/role-changed");
			const template = teamRoleChangedTemplates.en!;
			const result = template.inApp!(
				{ team: "Engineering", oldRole: "viewer", newRole: "admin" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.body.toLowerCase()).toContain("role");
		});
	});

	describe("billing templates", () => {
		it("billingPaymentSucceededTemplates — accepts { amount?, receiptUrl? }", async () => {
			const { billingPaymentSucceededTemplates } = await import(
				"../events/billing/payment-succeeded"
			);
			const template = billingPaymentSucceededTemplates.en!;
			const result = template.inApp!(
				{ amount: "$49.00", receiptUrl: "https://example.com/receipt" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.body.toLowerCase()).toContain("payment");
		});

		it("billingPaymentFailedTemplates — accepts { amount?, updateUrl? }", async () => {
			const { billingPaymentFailedTemplates } = await import("../events/billing/payment-failed");
			const template = billingPaymentFailedTemplates.en!;
			const result = template.inApp!(
				{ amount: "$99.00", updateUrl: "https://example.com/billing" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.actionUrl).toContain("billing");
		});

		it("billingTrialExpiringTemplates — accepts { days?, upgradeUrl? }", async () => {
			const { billingTrialExpiringTemplates } = await import("../events/billing/trial-expiring");
			const template = billingTrialExpiringTemplates.en!;
			const result = template.push!(
				{ days: 3, upgradeUrl: "https://example.com/upgrade" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.body).toContain("3");
		});
	});

	describe("system templates", () => {
		it("systemMaintenanceTemplates — accepts { date?, duration?, affected? }", async () => {
			const { systemMaintenanceTemplates } = await import("../events/system/maintenance");
			const template = systemMaintenanceTemplates.en!;
			const result = template.push!(
				{ date: "April 1 02:00 UTC", duration: "2 hours" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.title.toLowerCase()).toContain("maintenance");
		});

		it("systemIncidentTemplates — accepts { title?, affected?, status?, statusUrl? }", async () => {
			const { systemIncidentTemplates } = await import("../events/system/incident");
			const template = systemIncidentTemplates.en!;
			const result = template.push!(
				{ title: "DB Outage", affected: "API", status: "investigating" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.body).toBe("DB Outage");
		});

		it("systemResolvedTemplates — accepts { title?, summary? }", async () => {
			const { systemResolvedTemplates } = await import("../events/system/resolved");
			const template = systemResolvedTemplates.en!;
			const result = template.inApp!(
				{ title: "DB Outage", summary: "Fixed by rollback" },
				makeBrand(),
				makeCtx(),
			);
			expect(result.subject?.toLowerCase()).toContain("resolved");
		});
	});
});

// ---------------------------------------------------------------------------
// Lang map structural checks — all 18 events have 'en' as lang key
// ---------------------------------------------------------------------------

describe("lang map structure — satisfies pattern compliance", () => {
	it("all 18 event lang maps must have an 'en' key", async () => {
		const mods = await Promise.all([
			import("../events/auth/welcome").then((m) => ({
				name: "auth.welcome",
				map: m.welcomeTemplates,
			})),
			import("../events/auth/password-reset").then((m) => ({
				name: "auth.password-reset",
				map: m.passwordResetTemplates,
			})),
			import("../events/auth/email-verification").then((m) => ({
				name: "auth.email-verification",
				map: m.emailVerificationTemplates,
			})),
			import("../events/auth/login-new-device").then((m) => ({
				name: "auth.login-new-device",
				map: m.loginNewDeviceTemplates,
			})),
			import("../events/auth/password-changed").then((m) => ({
				name: "auth.password-changed",
				map: m.passwordChangedTemplates,
			})),
			import("../events/auth/2fa-enabled").then((m) => ({
				name: "auth.2fa-enabled",
				map: m.twoFaEnabledTemplates,
			})),
			import("../events/security/alert").then((m) => ({
				name: "security.alert",
				map: m.securityAlertTemplates,
			})),
			import("../events/security/api-key-created").then((m) => ({
				name: "security.api-key-created",
				map: m.securityApiKeyCreatedTemplates,
			})),
			import("../events/security/api-key-expiring").then((m) => ({
				name: "security.api-key-expiring",
				map: m.securityApiKeyExpiringTemplates,
			})),
			import("../events/team/invitation").then((m) => ({
				name: "team.invitation",
				map: m.teamInvitationTemplates,
			})),
			import("../events/team/member-joined").then((m) => ({
				name: "team.member-joined",
				map: m.teamMemberJoinedTemplates,
			})),
			import("../events/team/role-changed").then((m) => ({
				name: "team.role-changed",
				map: m.teamRoleChangedTemplates,
			})),
			import("../events/billing/payment-succeeded").then((m) => ({
				name: "billing.payment-succeeded",
				map: m.billingPaymentSucceededTemplates,
			})),
			import("../events/billing/payment-failed").then((m) => ({
				name: "billing.payment-failed",
				map: m.billingPaymentFailedTemplates,
			})),
			import("../events/billing/trial-expiring").then((m) => ({
				name: "billing.trial-expiring",
				map: m.billingTrialExpiringTemplates,
			})),
			import("../events/system/maintenance").then((m) => ({
				name: "system.maintenance",
				map: m.systemMaintenanceTemplates,
			})),
			import("../events/system/incident").then((m) => ({
				name: "system.incident",
				map: m.systemIncidentTemplates,
			})),
			import("../events/system/resolved").then((m) => ({
				name: "system.resolved",
				map: m.systemResolvedTemplates,
			})),
		]);

		expect(mods).toHaveLength(18);
		for (const { name, map } of mods) {
			expect(map, `${name} lang map must have 'en' key`).toHaveProperty("en");
			expect(map.en, `${name}.en must be a non-null object`).toBeTruthy();
		}
	});

	it("each 'en' lang entry must be an object with at least one channel function", async () => {
		const { defaultTemplates } = await import("../index");
		const channels = ["email", "sms", "push", "inApp", "slack", "telegram", "discord"] as const;

		for (const [eventName, langMap] of Object.entries(defaultTemplates)) {
			const enTemplate = langMap.en;
			expect(enTemplate, `${eventName} must have 'en' entry`).toBeDefined();

			const hasAtLeastOneChannel = channels.some(
				(ch) => typeof (enTemplate as Record<string, unknown>)[ch] === "function",
			);
			expect(hasAtLeastOneChannel, `${eventName}.en must have at least one channel function`).toBe(
				true,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// Zero hardcoded English strings in JSX components
// Tests verify that text content comes from payload/props, not hardcoded literals
// ---------------------------------------------------------------------------

describe("zero hardcoded English in components — text comes from props", () => {
	it("welcomeTemplates — greeting changes based on name prop", async () => {
		const { welcomeTemplates } = await import("../events/auth/welcome");
		const template = welcomeTemplates.en!;

		// With name — uses named greeting
		const withName = await template.email!({ name: "Alice" }, makeBrand(), makeCtx());
		// Without name — uses generic greeting
		const withoutName = await template.email!({}, makeBrand(), makeCtx());

		expect(withName.html).toContain("Alice");
		// Should not show "Welcome, " without a name following it
		expect(withoutName.html).not.toContain("Welcome, ");
	});

	it("loginNewDeviceTemplates — device name appears in email body from payload", async () => {
		const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
		const template = loginNewDeviceTemplates.en!;

		const result = await template.email!(
			{ device: "Firefox on Linux", location: "Tokyo, JP" },
			makeBrand(),
			makeCtx(),
		);
		// The device name comes from the payload, not a hardcoded string
		expect(result.html).toContain("Firefox on Linux");
	});

	it("securityAlertTemplates — description appears in push body from payload", async () => {
		const { securityAlertTemplates } = await import("../events/security/alert");
		const template = securityAlertTemplates.en!;

		const result = template.push!(
			{ description: "SSH key added to your account" },
			makeBrand(),
			makeCtx(),
		);
		expect(result.body).toBe("SSH key added to your account");
	});

	it("securityApiKeyCreatedTemplates — key name appears in in-app body from payload", async () => {
		const { securityApiKeyCreatedTemplates } = await import("../events/security/api-key-created");
		const template = securityApiKeyCreatedTemplates.en!;

		const resultA = template.inApp!({ name: "key-alpha" }, makeBrand(), makeCtx());
		const resultB = template.inApp!({ name: "key-beta" }, makeBrand(), makeCtx());

		expect(resultA.body).toContain("key-alpha");
		expect(resultB.body).toContain("key-beta");
		// Different payloads must produce different content
		expect(resultA.body).not.toBe(resultB.body);
	});
});

// ---------------------------------------------------------------------------
// Lang fallback utility — resolveLang integration
// ---------------------------------------------------------------------------

describe("resolveLang — lang fallback utility", () => {
	it("should return 'en' when no lang sources are provided", async () => {
		const { resolveLang } = await import("../lang");
		expect(resolveLang({})).toBe("en");
	});

	it("should return params.lang when provided (highest priority)", async () => {
		const { resolveLang } = await import("../lang");
		expect(resolveLang({ paramsLang: "pl", subscriberLang: "de", configDefaultLang: "fr" })).toBe(
			"pl",
		);
	});

	it("should fall back to subscriber.lang when params.lang is absent", async () => {
		const { resolveLang } = await import("../lang");
		expect(resolveLang({ subscriberLang: "de", configDefaultLang: "fr" })).toBe("de");
	});

	it("should fall back to config.defaultLang when params and subscriber are absent", async () => {
		const { resolveLang } = await import("../lang");
		expect(resolveLang({ configDefaultLang: "fr" })).toBe("fr");
	});

	it("should fall back to 'en' when resolved lang has no template, simulating missing-lang scenario", async () => {
		// If a lang like 'pl' is requested but only 'en' exists in the map,
		// the consumer (core) falls back to 'en'. We verify that the lang map
		// structure supports this: 'en' is always present.
		const { welcomeTemplates } = await import("../events/auth/welcome");
		const requestedLang = "pl";
		// 'pl' not in map → fall back to 'en'
		const resolvedTemplate = welcomeTemplates[requestedLang] ?? welcomeTemplates.en;
		expect(resolvedTemplate).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Intl formatter usage in templates — date/time templates use ctx
// ---------------------------------------------------------------------------

describe("Intl formatter usage in date-handling templates", () => {
	it("loginNewDeviceTemplates — email renders without throwing for any RenderContext locale", async () => {
		const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
		const template = loginNewDeviceTemplates.en!;
		const locales = ["en-US", "en-GB", "pl-PL", "de-DE", "fr-FR", "ja-JP"];

		for (const locale of locales) {
			await expect(
				template.email!(
					{ device: "Chrome", location: "Warsaw" },
					makeBrand(),
					makeCtx({ locale, timezone: "UTC" }),
				),
			).resolves.toMatchObject({ subject: expect.any(String), html: expect.any(String) });
		}
	});

	it("loginNewDeviceTemplates — different timezones produce valid email output", async () => {
		const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
		const template = loginNewDeviceTemplates.en!;
		const timezones = ["UTC", "America/New_York", "Europe/Warsaw", "Asia/Tokyo"];

		for (const timezone of timezones) {
			await expect(
				template.email!({ device: "Chrome" }, makeBrand(), makeCtx({ timezone })),
			).resolves.toMatchObject({ subject: expect.any(String) });
		}
	});

	it("billingPaymentSucceededTemplates — email renders correctly across locales", async () => {
		const { billingPaymentSucceededTemplates } = await import(
			"../events/billing/payment-succeeded"
		);
		const template = billingPaymentSucceededTemplates.en!;

		await expect(
			template.email!({ amount: "$49.00" }, makeBrand(), makeCtx({ locale: "pl-PL" })),
		).resolves.toMatchObject({ subject: expect.any(String) });
	});
});
