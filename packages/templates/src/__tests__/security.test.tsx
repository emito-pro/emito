/**
 * Tests for security event templates (Task 2 — 3 events).
 *
 * Events covered:
 *   security.alert, security.api-key-created, security.api-key-expiring
 *
 * Success criteria (from plan):
 *   - All 3 events render correctly for each applicable channel
 *   - Email HTML is valid with BrandTheme applied
 *   - SMS under 160 chars
 *   - Slack produces valid blocks (security.alert only)
 *   - Telegram produces valid HTML subset (security.alert only)
 *   - All registered in defaultTemplates under 'en' lang
 *
 * Architecture spec (Section 20):
 *   security.alert:             email, SMS, push, in-app, Slack, Telegram
 *   security.api-key-created:   email, in-app
 *   security.api-key-expiring:  email, in-app
 *
 * Rules applied (testing standards):
 *   - Assert on shape of return values, not just existence (rule 26)
 *   - Prefer specific matchers over generic ones (rule 25)
 *   - Use toMatchObject for partial assertions on large objects (rule 27)
 *   - Test boundary conditions for optional parameters (rule 5)
 *   - Follow describe("moduleName") > it("should X when Y") naming (rule 15)
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
// security.alert
// ---------------------------------------------------------------------------

describe("security.alert template", () => {
	it("should export a Record keyed by lang with 'en' entry", async () => {
		const { securityAlertTemplates } = await import("../events/security/alert");
		expect(securityAlertTemplates).toHaveProperty("en");
	});

	describe("email channel", () => {
		it("should render email with subject containing description", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			expect(typeof template?.email).toBe("function");

			const content = await template!.email!(
				{
					description: "Suspicious login attempt",
					secureUrl: "https://testapp.example.com/security",
				},
				makeBrand(),
				makeCtx(),
			);

			expect(content.subject.toLowerCase()).toContain("security");
			expect(content.subject).toContain("Suspicious login attempt");
			expect(typeof content.html).toBe("string");
			expect(content.html.length).toBeGreaterThan(0);
			expect(typeof content.text).toBe("string");
		});

		it("should include a Secure Account CTA in email", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			const content = await template!.email!(
				{ description: "New login", secureUrl: "https://testapp.example.com/security" },
				makeBrand(),
				makeCtx(),
			);
			expect(content.text.toLowerCase()).toMatch(/secure|account/);
		});

		it("should apply BrandTheme to rendered HTML", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			const brand = makeBrand({ name: "MyApp" });
			const content = await template!.email!(
				{ description: "Suspicious login", secureUrl: "https://myapp.com/security" },
				brand,
				makeCtx(),
			);
			expect(content.html).toContain("MyApp");
		});
	});

	describe("SMS channel", () => {
		it("should render SMS body under 160 chars", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			expect(typeof template?.sms).toBe("function");

			const brand = makeBrand({ name: "TestApp" });
			const content = template!.sms!(
				{
					description: "Suspicious login attempt",
					secureUrl: "https://testapp.example.com/security",
				},
				brand,
				makeCtx(),
			);

			expect(typeof content.body).toBe("string");
			expect(content.body.length).toBeLessThanOrEqual(160);
		});

		it("should include brand name in SMS body", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			const brand = makeBrand({ name: "MyBrand" });
			const content = template!.sms!(
				{ description: "Suspicious login", secureUrl: "https://example.com/s" },
				brand,
				makeCtx(),
			);
			expect(content.body).toContain("MyBrand");
		});

		it("should truncate SMS body to 160 chars when description is very long", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			const longDescription = "A".repeat(200);
			const brand = makeBrand({ name: "TestApp" });
			const content = template!.sms!(
				{ description: longDescription, secureUrl: "https://testapp.example.com/security" },
				brand,
				makeCtx(),
			);
			expect(content.body.length).toBeLessThanOrEqual(160);
		});
	});

	describe("push channel", () => {
		it("should render push with title 'Security Alert' and description as body", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			expect(typeof template?.push).toBe("function");

			const content = template!.push!(
				{ description: "Suspicious login attempt", secureUrl: "https://example.com/security" },
				makeBrand(),
				makeCtx(),
			);

			expect(typeof content.title).toBe("string");
			expect(content.title.toLowerCase()).toMatch(/security|alert/);
			expect(content.body).toBe("Suspicious login attempt");
		});
	});

	describe("in-app channel", () => {
		it("should render in-app with subject 'Security Alert' and action to /security", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			expect(typeof template?.inApp).toBe("function");

			const content = template!.inApp!(
				{
					description: "Suspicious login attempt",
					secureUrl: "https://testapp.example.com/security",
				},
				makeBrand(),
				makeCtx(),
			);

			expect(typeof content.subject).toBe("string");
			expect(content.subject?.toLowerCase()).toMatch(/security|alert/);
			expect(content.body).toContain("Suspicious login attempt");
			expect(content.actionUrl).toBeDefined();
			expect(content.actionUrl).toContain("security");
		});
	});

	describe("Slack channel", () => {
		it("should produce valid Slack blocks array with text fallback", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			expect(typeof template?.slack).toBe("function");

			const content = template!.slack!(
				{
					description: "Suspicious login attempt",
					secureUrl: "https://testapp.example.com/security",
				},
				makeBrand(),
				makeCtx(),
			);

			expect(content.blocks).toBeInstanceOf(Array);
			expect(content.blocks.length).toBeGreaterThan(0);
			expect(typeof content.text).toBe("string");
			expect(content.text.length).toBeGreaterThan(0);
		});

		it("should include a header block in Slack output mentioning security", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			const content = template!.slack!(
				{
					description: "Suspicious login attempt",
					secureUrl: "https://testapp.example.com/security",
				},
				makeBrand(),
				makeCtx(),
			);

			const blocks = content.blocks as Array<{
				type: string;
				text?: { type: string; text: string };
			}>;
			const headerBlock = blocks.find((b) => b.type === "header");
			expect(headerBlock).toBeDefined();
			expect(headerBlock?.text?.text.toLowerCase()).toMatch(/security|alert/);
		});

		it("should include a danger-styled button block in Slack output", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			const content = template!.slack!(
				{
					description: "Suspicious login attempt",
					secureUrl: "https://testapp.example.com/security",
				},
				makeBrand(),
				makeCtx(),
			);

			const allBlocks = content.blocks as Array<{
				type: string;
				elements?: Array<{ type: string; style?: string; url?: string }>;
			}>;
			const actionsBlock = allBlocks.find((b) => b.type === "actions");
			expect(actionsBlock).toBeDefined();

			const dangerButton = actionsBlock?.elements?.find(
				(e) => e.type === "button" && e.style === "danger",
			);
			expect(dangerButton).toBeDefined();
		});
	});

	describe("Telegram channel", () => {
		it("should produce valid Telegram HTML subset (b, i, a, code, pre only)", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			expect(typeof template?.telegram).toBe("function");

			const content = template!.telegram!(
				{
					description: "Suspicious login attempt",
					secureUrl: "https://testapp.example.com/security",
				},
				makeBrand(),
				makeCtx(),
			);

			expect(typeof content.html).toBe("string");
			expect(content.html.length).toBeGreaterThan(0);

			// Verify only valid Telegram HTML tags are used
			const tagPattern = /<([a-z]+)/gi;
			const validTelegramTags = new Set(["b", "i", "a", "code", "pre"]);
			const matches = [...content.html.matchAll(tagPattern)];
			for (const match of matches) {
				expect(validTelegramTags).toContain(match[1]?.toLowerCase());
			}
		});

		it("should include bold security alert title", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			const content = template!.telegram!(
				{
					description: "Suspicious login attempt",
					secureUrl: "https://testapp.example.com/security",
				},
				makeBrand(),
				makeCtx(),
			);

			expect(content.html).toContain("<b>");
			expect(content.html.toLowerCase()).toMatch(/security|alert/);
		});

		it("should include a link to the secure URL", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const template = securityAlertTemplates.en;
			const content = template!.telegram!(
				{
					description: "Suspicious login attempt",
					secureUrl: "https://testapp.example.com/security",
				},
				makeBrand(),
				makeCtx(),
			);

			expect(content.html).toContain("https://testapp.example.com/security");
		});
	});
});

// ---------------------------------------------------------------------------
// security.api-key-created
// ---------------------------------------------------------------------------

describe("security.api-key-created template", () => {
	it("should export a Record keyed by lang with 'en' entry", async () => {
		const { securityApiKeyCreatedTemplates: apiKeyCreatedTemplates } = await import(
			"../events/security/api-key-created"
		);
		expect(apiKeyCreatedTemplates).toHaveProperty("en");
	});

	describe("email channel", () => {
		it("should render email with subject 'New API key created'", async () => {
			const { securityApiKeyCreatedTemplates: apiKeyCreatedTemplates } = await import(
				"../events/security/api-key-created"
			);
			const template = apiKeyCreatedTemplates.en;
			expect(typeof template?.email).toBe("function");

			const content = await template!.email!(
				{ name: "my-service-key", permissions: "read, write", createdBy: "admin@example.com" },
				makeBrand(),
				makeCtx(),
			);

			expect(content.subject.toLowerCase()).toMatch(/api.*key|new.*key|key.*created/);
			expect(typeof content.html).toBe("string");
			expect(typeof content.text).toBe("string");
		});

		it("should include a Manage Keys CTA in email", async () => {
			const { securityApiKeyCreatedTemplates: apiKeyCreatedTemplates } = await import(
				"../events/security/api-key-created"
			);
			const template = apiKeyCreatedTemplates.en;
			const content = await template!.email!(
				{ name: "my-service-key", permissions: "read", createdBy: "admin@example.com" },
				makeBrand(),
				makeCtx(),
			);

			expect(content.text.toLowerCase()).toMatch(/manage|key/);
		});
	});

	describe("in-app channel", () => {
		it("should render in-app with subject 'API key created' and action to /settings/api-keys", async () => {
			const { securityApiKeyCreatedTemplates: apiKeyCreatedTemplates } = await import(
				"../events/security/api-key-created"
			);
			const template = apiKeyCreatedTemplates.en;
			expect(typeof template?.inApp).toBe("function");

			const content = template!.inApp!(
				{ name: "my-service-key", permissions: "read", createdBy: "admin@example.com" },
				makeBrand(),
				makeCtx(),
			);

			expect(typeof content.subject).toBe("string");
			expect(content.subject?.toLowerCase()).toMatch(/api.*key|key.*created/);
			expect(content.body).toContain("my-service-key");
			// Architecture spec: Action "Manage" → /settings/api-keys
			expect(content.actionUrl).toBeDefined();
			expect(content.actionUrl).toMatch(/api.key/);
		});
	});

	it("should NOT have SMS channel (not in architecture spec)", async () => {
		const { securityApiKeyCreatedTemplates: apiKeyCreatedTemplates } = await import(
			"../events/security/api-key-created"
		);
		expect(apiKeyCreatedTemplates.en?.sms).toBeUndefined();
	});

	it("should NOT have push channel (not in architecture spec)", async () => {
		const { securityApiKeyCreatedTemplates: apiKeyCreatedTemplates } = await import(
			"../events/security/api-key-created"
		);
		expect(apiKeyCreatedTemplates.en?.push).toBeUndefined();
	});

	it("should NOT have Slack channel (not in architecture spec)", async () => {
		const { securityApiKeyCreatedTemplates: apiKeyCreatedTemplates } = await import(
			"../events/security/api-key-created"
		);
		expect(apiKeyCreatedTemplates.en?.slack).toBeUndefined();
	});

	it("should NOT have Telegram channel (not in architecture spec)", async () => {
		const { securityApiKeyCreatedTemplates: apiKeyCreatedTemplates } = await import(
			"../events/security/api-key-created"
		);
		expect(apiKeyCreatedTemplates.en?.telegram).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// security.api-key-expiring
// ---------------------------------------------------------------------------

describe("security.api-key-expiring template", () => {
	it("should export a Record keyed by lang with 'en' entry", async () => {
		const { securityApiKeyExpiringTemplates: apiKeyExpiringTemplates } = await import(
			"../events/security/api-key-expiring"
		);
		expect(apiKeyExpiringTemplates).toHaveProperty("en");
	});

	describe("email channel", () => {
		it("should render email with subject containing 'API key expires in {days} days'", async () => {
			const { securityApiKeyExpiringTemplates: apiKeyExpiringTemplates } = await import(
				"../events/security/api-key-expiring"
			);
			const template = apiKeyExpiringTemplates.en;
			expect(typeof template?.email).toBe("function");

			const content = await template!.email!(
				{ name: "my-service-key", days: 7 },
				makeBrand(),
				makeCtx(),
			);

			expect(content.subject.toLowerCase()).toMatch(/api.*key|key.*expir/);
			expect(content.subject).toContain("7");
			expect(typeof content.html).toBe("string");
			expect(typeof content.text).toBe("string");
		});

		it("should include the key name in email content", async () => {
			const { securityApiKeyExpiringTemplates: apiKeyExpiringTemplates } = await import(
				"../events/security/api-key-expiring"
			);
			const template = apiKeyExpiringTemplates.en;
			const content = await template!.email!(
				{ name: "my-unique-key-name", days: 3 },
				makeBrand(),
				makeCtx(),
			);
			const hasKeyName =
				content.subject.includes("my-unique-key-name") ||
				content.text.includes("my-unique-key-name") ||
				content.html.includes("my-unique-key-name");
			expect(hasKeyName).toBe(true);
		});
	});

	describe("in-app channel", () => {
		it("should render in-app with subject 'API key expiring' and renew action to /settings/api-keys", async () => {
			const { securityApiKeyExpiringTemplates: apiKeyExpiringTemplates } = await import(
				"../events/security/api-key-expiring"
			);
			const template = apiKeyExpiringTemplates.en;
			expect(typeof template?.inApp).toBe("function");

			const content = template!.inApp!({ name: "my-service-key", days: 7 }, makeBrand(), makeCtx());

			expect(typeof content.subject).toBe("string");
			expect(content.subject?.toLowerCase()).toMatch(/api.*key|key.*expir/);
			expect(content.body).toContain("my-service-key");
			expect(content.body).toContain("7");
			// Architecture spec: Action "Renew" → /settings/api-keys
			expect(content.actionUrl).toBeDefined();
			expect(content.actionUrl).toMatch(/api.key/);
		});
	});

	it("should NOT have SMS channel (not in architecture spec)", async () => {
		const { securityApiKeyExpiringTemplates: apiKeyExpiringTemplates } = await import(
			"../events/security/api-key-expiring"
		);
		expect(apiKeyExpiringTemplates.en?.sms).toBeUndefined();
	});

	it("should NOT have push channel (not in architecture spec)", async () => {
		const { securityApiKeyExpiringTemplates: apiKeyExpiringTemplates } = await import(
			"../events/security/api-key-expiring"
		);
		expect(apiKeyExpiringTemplates.en?.push).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// defaultTemplates registration — all 3 security events under 'en'
// ---------------------------------------------------------------------------

describe("defaultTemplates — security events registration", () => {
	it("should export defaultTemplates containing all 3 security events", async () => {
		const { defaultTemplates } = await import("../index");

		expect(defaultTemplates).toHaveProperty("security.alert");
		expect(defaultTemplates).toHaveProperty("security.api-key-created");
		expect(defaultTemplates).toHaveProperty("security.api-key-expiring");
	});

	it("should have 'en' lang key for each security event", async () => {
		const { defaultTemplates } = await import("../index");

		const securityEvents = [
			"security.alert",
			"security.api-key-created",
			"security.api-key-expiring",
		];

		for (const event of securityEvents) {
			expect(defaultTemplates[event]).toHaveProperty("en");
		}
	});
});

// ---------------------------------------------------------------------------
// Minimal-props tests — exercise falsy branches for optional fields
// ---------------------------------------------------------------------------

describe("security templates — renders with minimal props", () => {
	const minimalBrand: BrandTheme = { name: "Min", appUrl: "https://min.example.com" };
	const ctx = makeCtx();

	describe("security.alert with minimal payload", () => {
		it("should render email with default description when payload is empty", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const content = await securityAlertTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.subject).toContain("Suspicious activity detected");
			expect(content.html).toContain("Min");
		});

		it("should render SMS with default description and empty secureUrl", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const content = securityAlertTemplates.en!.sms!({}, minimalBrand, ctx);
			expect(content.body).toContain("Min");
			expect(content.body).toContain("Suspicious activity");
		});

		it("should render push with default description", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const content = securityAlertTemplates.en!.push!({}, minimalBrand, ctx);
			expect(content.body).toBe("Suspicious activity detected");
		});

		it("should render in-app with default description", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const content = securityAlertTemplates.en!.inApp!({}, minimalBrand, ctx);
			expect(content.body).toBe("Suspicious activity detected");
		});

		it("should render Slack without fields when device/location/ip/time are absent", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const content = securityAlertTemplates.en!.slack!({}, minimalBrand, ctx);
			expect(content.blocks).toBeInstanceOf(Array);
			expect(typeof content.text).toBe("string");
		});

		it("should render Telegram without fields when device/location/ip are absent", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const content = securityAlertTemplates.en!.telegram!({}, minimalBrand, ctx);
			expect(typeof content.html).toBe("string");
			expect(content.html).toContain("Security Alert");
		});

		it("should render Slack with fields when device/location/ip/time are present", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const content = securityAlertTemplates.en!.slack!(
				{
					description: "Alert",
					secureUrl: "https://x.com/s",
					device: "Chrome",
					location: "Warsaw",
					ip: "1.2.3.4",
					time: "12:00",
				},
				minimalBrand,
				ctx,
			);
			expect(content.text).toContain("Alert");
		});

		it("should render Telegram with fields when device/location/ip are present", async () => {
			const { securityAlertTemplates } = await import("../events/security/alert");
			const content = securityAlertTemplates.en!.telegram!(
				{
					description: "Alert",
					secureUrl: "https://x.com/s",
					device: "Chrome",
					location: "Warsaw",
					ip: "1.2.3.4",
				},
				minimalBrand,
				ctx,
			);
			expect(content.html).toContain("Chrome");
			expect(content.html).toContain("Warsaw");
			expect(content.html).toContain("1.2.3.4");
		});
	});

	describe("security.api-key-created with minimal payload", () => {
		it("should render email with default key name and no permissions/createdBy", async () => {
			const { securityApiKeyCreatedTemplates } = await import("../events/security/api-key-created");
			const content = await securityApiKeyCreatedTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.html).toContain("Unnamed key");
			expect(content.html).not.toContain("Permissions:");
			expect(content.html).not.toContain("Created by:");
			expect(content.text).not.toContain("Permissions:");
			expect(content.text).not.toContain("Created by:");
		});

		it("should render in-app with default key name", async () => {
			const { securityApiKeyCreatedTemplates } = await import("../events/security/api-key-created");
			const content = securityApiKeyCreatedTemplates.en!.inApp!({}, minimalBrand, ctx);
			expect(content.body).toContain("Unnamed key");
		});
	});

	describe("security.api-key-expiring with minimal payload", () => {
		it("should render email with default key name and days", async () => {
			const { securityApiKeyExpiringTemplates } = await import(
				"../events/security/api-key-expiring"
			);
			const content = await securityApiKeyExpiringTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.subject).toContain("7");
			expect(content.html).toContain("Unnamed key");
		});

		it("should render in-app with default key name and days", async () => {
			const { securityApiKeyExpiringTemplates } = await import(
				"../events/security/api-key-expiring"
			);
			const content = securityApiKeyExpiringTemplates.en!.inApp!({}, minimalBrand, ctx);
			expect(content.body).toContain("Unnamed key");
			expect(content.body).toContain("7");
		});
	});
});

// ---------------------------------------------------------------------------
// Combined: all 9 task-2 events are in defaultTemplates
// ---------------------------------------------------------------------------

describe("defaultTemplates — all task-2 events (auth + security)", () => {
	it("should contain all 9 auth and security events under 'en' lang", async () => {
		const { defaultTemplates } = await import("../index");

		const task2Events = [
			"auth.welcome",
			"auth.password-reset",
			"auth.email-verification",
			"auth.login-new-device",
			"auth.password-changed",
			"auth.2fa-enabled",
			"security.alert",
			"security.api-key-created",
			"security.api-key-expiring",
		];

		for (const event of task2Events) {
			expect(defaultTemplates).toHaveProperty(event);
			expect(defaultTemplates[event]).toHaveProperty("en");
		}
	});
});
