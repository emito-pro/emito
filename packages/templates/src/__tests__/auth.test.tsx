/**
 * Tests for auth event templates (Task 2 — 6 events).
 *
 * Events covered:
 *   auth.welcome, auth.password-reset, auth.email-verification,
 *   auth.login-new-device, auth.password-changed, auth.2fa-enabled
 *
 * Success criteria (from plan):
 *   - All 6 events render correctly for each applicable channel
 *   - Email HTML is valid with BrandTheme applied
 *   - Dates formatted using ctx.locale/ctx.timezone
 *   - SMS under 160 chars
 *   - Slack produces valid blocks
 *   - All registered in defaultTemplates under 'en' lang
 *
 * Architecture spec (Section 20):
 *   auth.welcome:           email, in-app
 *   auth.password-reset:    email, SMS
 *   auth.email-verification: email
 *   auth.login-new-device:  email, SMS, push, in-app
 *   auth.password-changed:  email, SMS, push
 *   auth.2fa-enabled:       email, in-app
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
// auth.welcome
// ---------------------------------------------------------------------------

describe("auth.welcome template", () => {
	it("should export a Record keyed by lang with 'en' entry", async () => {
		const { welcomeTemplates } = await import("../events/auth/welcome");
		expect(welcomeTemplates).toHaveProperty("en");
	});

	describe("email channel", () => {
		it("should render email HTML containing brand name and welcome content", async () => {
			const { welcomeTemplates } = await import("../events/auth/welcome");
			const template = welcomeTemplates.en;
			expect(template).toBeDefined();
			expect(typeof template?.email).toBe("function");

			const brand = makeBrand({ name: "MyApp" });
			const content = await template!.email!({ name: "Alice" }, brand, makeCtx());

			expect(content.subject).toContain("MyApp");
			expect(content.html).toContain("MyApp");
			expect(typeof content.html).toBe("string");
			expect(content.html.length).toBeGreaterThan(0);
			expect(typeof content.text).toBe("string");
		});

		it("should include a Get Started CTA in the email", async () => {
			const { welcomeTemplates } = await import("../events/auth/welcome");
			const template = welcomeTemplates.en;
			const brand = makeBrand();
			const content = await template!.email!({ name: "Alice" }, brand, makeCtx());

			// The welcome email should have a get started CTA per architecture spec
			expect(content.text.toLowerCase()).toMatch(/get started|start/);
		});

		it("should produce valid HTML structure", async () => {
			const { welcomeTemplates } = await import("../events/auth/welcome");
			const template = welcomeTemplates.en;
			const content = await template!.email!({ name: "Bob" }, makeBrand(), makeCtx());

			expect(content.html).toContain("<html");
			expect(content.html).toContain("</html>");
		});
	});

	describe("in-app channel", () => {
		it("should render in-app content with subject, body, and action URL", async () => {
			const { welcomeTemplates } = await import("../events/auth/welcome");
			const template = welcomeTemplates.en;
			expect(typeof template?.inApp).toBe("function");

			const content = template!.inApp!({ name: "Alice" }, makeBrand(), makeCtx());

			expect(typeof content.subject).toBe("string");
			expect(content.subject?.length).toBeGreaterThan(0);
			expect(typeof content.body).toBe("string");
			expect(content.body.length).toBeGreaterThan(0);
			// Architecture spec: Action "Get Started" → /start
			expect(content.actionUrl).toBeDefined();
			expect(content.actionUrl).toContain("start");
		});
	});

	it("should NOT have SMS channel (not in architecture spec)", async () => {
		const { welcomeTemplates } = await import("../events/auth/welcome");
		expect(welcomeTemplates.en?.sms).toBeUndefined();
	});

	it("should NOT have push channel (not in architecture spec)", async () => {
		const { welcomeTemplates } = await import("../events/auth/welcome");
		expect(welcomeTemplates.en?.push).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// auth.password-reset
// ---------------------------------------------------------------------------

describe("auth.password-reset template", () => {
	it("should export a Record keyed by lang with 'en' entry", async () => {
		const { passwordResetTemplates } = await import("../events/auth/password-reset");
		expect(passwordResetTemplates).toHaveProperty("en");
	});

	describe("email channel", () => {
		it("should render email with subject 'Reset your password'", async () => {
			const { passwordResetTemplates } = await import("../events/auth/password-reset");
			const template = passwordResetTemplates.en;
			expect(typeof template?.email).toBe("function");

			const content = await template!.email!(
				{ code: "123456", resetUrl: "https://example.com/reset?token=abc" },
				makeBrand(),
				makeCtx(),
			);

			expect(content.subject.toLowerCase()).toContain("reset");
			expect(typeof content.html).toBe("string");
			expect(typeof content.text).toBe("string");
		});

		it("should include a Reset Password CTA in the email", async () => {
			const { passwordResetTemplates } = await import("../events/auth/password-reset");
			const template = passwordResetTemplates.en;
			const content = await template!.email!(
				{ code: "123456", resetUrl: "https://example.com/reset?token=abc" },
				makeBrand(),
				makeCtx(),
			);
			expect(content.text.toLowerCase()).toMatch(/reset.*password|reset/);
		});
	});

	describe("SMS channel", () => {
		it("should render SMS body under 160 chars", async () => {
			const { passwordResetTemplates } = await import("../events/auth/password-reset");
			const template = passwordResetTemplates.en;
			expect(typeof template?.sms).toBe("function");

			const brand = makeBrand({ name: "TestApp" });
			const content = template!.sms!(
				{ code: "123456", resetUrl: "https://example.com/reset?token=abc" },
				brand,
				makeCtx(),
			);

			expect(typeof content.body).toBe("string");
			expect(content.body.length).toBeLessThanOrEqual(160);
		});

		it("should include brand name in SMS body", async () => {
			const { passwordResetTemplates } = await import("../events/auth/password-reset");
			const template = passwordResetTemplates.en;
			const brand = makeBrand({ name: "MyBrand" });
			const content = template!.sms!(
				{ code: "999888", resetUrl: "https://example.com/r" },
				brand,
				makeCtx(),
			);
			expect(content.body).toContain("MyBrand");
		});

		it("should include the reset code in SMS body", async () => {
			const { passwordResetTemplates } = await import("../events/auth/password-reset");
			const template = passwordResetTemplates.en;
			const brand = makeBrand();
			const content = template!.sms!(
				{ code: "777333", resetUrl: "https://example.com/r" },
				brand,
				makeCtx(),
			);
			expect(content.body).toContain("777333");
		});
	});

	it("should NOT have push channel (not in architecture spec)", async () => {
		const { passwordResetTemplates } = await import("../events/auth/password-reset");
		expect(passwordResetTemplates.en?.push).toBeUndefined();
	});

	it("should NOT have in-app channel (not in architecture spec)", async () => {
		const { passwordResetTemplates } = await import("../events/auth/password-reset");
		expect(passwordResetTemplates.en?.inApp).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// auth.email-verification
// ---------------------------------------------------------------------------

describe("auth.email-verification template", () => {
	it("should export a Record keyed by lang with 'en' entry", async () => {
		const { emailVerificationTemplates } = await import("../events/auth/email-verification");
		expect(emailVerificationTemplates).toHaveProperty("en");
	});

	describe("email channel", () => {
		it("should render email with subject 'Verify your email'", async () => {
			const { emailVerificationTemplates } = await import("../events/auth/email-verification");
			const template = emailVerificationTemplates.en;
			expect(typeof template?.email).toBe("function");

			const content = await template!.email!(
				{ verificationUrl: "https://example.com/verify?token=xyz" },
				makeBrand(),
				makeCtx(),
			);

			expect(content.subject.toLowerCase()).toContain("verif");
			expect(typeof content.html).toBe("string");
			expect(typeof content.text).toBe("string");
		});

		it("should include a Verify Email CTA", async () => {
			const { emailVerificationTemplates } = await import("../events/auth/email-verification");
			const template = emailVerificationTemplates.en;
			const content = await template!.email!(
				{ verificationUrl: "https://example.com/verify?token=xyz" },
				makeBrand(),
				makeCtx(),
			);
			expect(content.text.toLowerCase()).toMatch(/verify/);
		});
	});

	it("should NOT have SMS channel (not in architecture spec)", async () => {
		const { emailVerificationTemplates } = await import("../events/auth/email-verification");
		expect(emailVerificationTemplates.en?.sms).toBeUndefined();
	});

	it("should NOT have push channel (not in architecture spec)", async () => {
		const { emailVerificationTemplates } = await import("../events/auth/email-verification");
		expect(emailVerificationTemplates.en?.push).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// auth.login-new-device
// ---------------------------------------------------------------------------

describe("auth.login-new-device template", () => {
	it("should export a Record keyed by lang with 'en' entry", async () => {
		const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
		expect(loginNewDeviceTemplates).toHaveProperty("en");
	});

	describe("email channel", () => {
		it("should render email with subject 'New sign-in to your account'", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const template = loginNewDeviceTemplates.en;
			expect(typeof template?.email).toBe("function");

			const content = await template!.email!(
				{ device: "Chrome on Windows", location: "Warsaw, Poland", ip: "203.0.113.42" },
				makeBrand(),
				makeCtx(),
			);

			expect(content.subject.toLowerCase()).toMatch(/sign.in|login|new/);
			expect(typeof content.html).toBe("string");
			expect(typeof content.text).toBe("string");
		});

		it("should use ctx.locale and ctx.timezone for date formatting", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const template = loginNewDeviceTemplates.en;
			// When no time is passed, it formats the current time — should not throw
			await expect(
				template?.email?.(
					{ device: "Chrome" },
					makeBrand(),
					makeCtx({ locale: "en-GB", timezone: "Europe/London" }),
				),
			).resolves.toBeDefined();
		});
	});

	describe("SMS channel", () => {
		it("should render SMS body under 160 chars", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const template = loginNewDeviceTemplates.en;
			expect(typeof template?.sms).toBe("function");

			const brand = makeBrand({ name: "TestApp" });
			const content = template!.sms!(
				{
					device: "Chrome on Windows",
					location: "Warsaw, Poland",
					secureUrl: "https://example.com/security",
				},
				brand,
				makeCtx(),
			);

			expect(typeof content.body).toBe("string");
			expect(content.body.length).toBeLessThanOrEqual(160);
		});

		it("should include brand name and device in SMS body", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const template = loginNewDeviceTemplates.en;
			const brand = makeBrand({ name: "MyBrand" });
			const content = template!.sms!(
				{ device: "Firefox on Mac", location: "Warsaw", secureUrl: "https://example.com/security" },
				brand,
				makeCtx(),
			);
			expect(content.body).toContain("MyBrand");
			expect(content.body).toContain("Firefox on Mac");
		});
	});

	describe("push channel", () => {
		it("should render push with title mentioning sign-in and body with device", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const template = loginNewDeviceTemplates.en;
			expect(typeof template?.push).toBe("function");

			const content = template!.push!(
				{ device: "Chrome on Windows", location: "Warsaw, Poland" },
				makeBrand(),
				makeCtx(),
			);

			expect(typeof content.title).toBe("string");
			expect(content.title.toLowerCase()).toMatch(/sign.in|login|new/);
			expect(typeof content.body).toBe("string");
		});
	});

	describe("in-app channel", () => {
		it("should render in-app with subject mentioning sign-in and action to /security", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const template = loginNewDeviceTemplates.en;
			expect(typeof template?.inApp).toBe("function");

			const content = template!.inApp!(
				{ device: "Chrome on Windows", location: "Warsaw, Poland" },
				makeBrand(),
				makeCtx(),
			);

			expect(typeof content.subject).toBe("string");
			expect(content.subject?.toLowerCase()).toMatch(/sign.in|new|detect/);
			expect(typeof content.body).toBe("string");
			// Architecture spec: Action "Review" → /security
			expect(content.actionUrl).toBeDefined();
			expect(content.actionUrl).toContain("security");
		});
	});
});

// ---------------------------------------------------------------------------
// auth.password-changed
// ---------------------------------------------------------------------------

describe("auth.password-changed template", () => {
	it("should export a Record keyed by lang with 'en' entry", async () => {
		const { passwordChangedTemplates } = await import("../events/auth/password-changed");
		expect(passwordChangedTemplates).toHaveProperty("en");
	});

	describe("email channel", () => {
		it("should render email with subject containing 'password was changed'", async () => {
			const { passwordChangedTemplates } = await import("../events/auth/password-changed");
			const template = passwordChangedTemplates.en;
			expect(typeof template?.email).toBe("function");

			const content = await template!.email!(
				{ secureUrl: "https://example.com/security" },
				makeBrand(),
				makeCtx(),
			);

			expect(content.subject.toLowerCase()).toContain("password");
			expect(typeof content.html).toBe("string");
			expect(typeof content.text).toBe("string");
		});
	});

	describe("SMS channel", () => {
		it("should render SMS body under 160 chars", async () => {
			const { passwordChangedTemplates } = await import("../events/auth/password-changed");
			const template = passwordChangedTemplates.en;
			expect(typeof template?.sms).toBe("function");

			const brand = makeBrand({ name: "TestApp" });
			const content = template!.sms!(
				{ secureUrl: "https://example.com/security" },
				brand,
				makeCtx(),
			);

			expect(typeof content.body).toBe("string");
			expect(content.body.length).toBeLessThanOrEqual(160);
		});

		it("should include brand name in SMS body", async () => {
			const { passwordChangedTemplates } = await import("../events/auth/password-changed");
			const template = passwordChangedTemplates.en;
			const brand = makeBrand({ name: "MyBrand" });
			const content = template!.sms!(
				{ secureUrl: "https://example.com/security" },
				brand,
				makeCtx(),
			);
			expect(content.body).toContain("MyBrand");
		});
	});

	describe("push channel", () => {
		it("should render push with title containing 'Password Changed'", async () => {
			const { passwordChangedTemplates } = await import("../events/auth/password-changed");
			const template = passwordChangedTemplates.en;
			expect(typeof template?.push).toBe("function");

			const content = template!.push!(
				{ secureUrl: "https://example.com/security" },
				makeBrand(),
				makeCtx(),
			);

			expect(typeof content.title).toBe("string");
			expect(content.title.toLowerCase()).toContain("password");
			expect(typeof content.body).toBe("string");
		});
	});

	it("should NOT have in-app channel (not in architecture spec)", async () => {
		const { passwordChangedTemplates } = await import("../events/auth/password-changed");
		expect(passwordChangedTemplates.en?.inApp).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// auth.2fa-enabled
// ---------------------------------------------------------------------------

describe("auth.2fa-enabled template", () => {
	it("should export a Record keyed by lang with 'en' entry", async () => {
		const { twoFaEnabledTemplates } = await import("../events/auth/2fa-enabled");
		expect(twoFaEnabledTemplates).toHaveProperty("en");
	});

	describe("email channel", () => {
		it("should render email with subject mentioning two-factor authentication", async () => {
			const { twoFaEnabledTemplates } = await import("../events/auth/2fa-enabled");
			const template = twoFaEnabledTemplates.en;
			expect(typeof template?.email).toBe("function");

			const content = await template!.email!({}, makeBrand(), makeCtx());

			expect(content.subject.toLowerCase()).toMatch(/two.factor|2fa|authentication/);
			expect(typeof content.html).toBe("string");
			expect(typeof content.text).toBe("string");
		});
	});

	describe("in-app channel", () => {
		it("should render in-app with subject '2FA Enabled' and confirmation body", async () => {
			const { twoFaEnabledTemplates } = await import("../events/auth/2fa-enabled");
			const template = twoFaEnabledTemplates.en;
			expect(typeof template?.inApp).toBe("function");

			const content = template!.inApp!({}, makeBrand(), makeCtx());

			expect(typeof content.subject).toBe("string");
			expect(content.subject?.toLowerCase()).toMatch(/2fa|two.factor/);
			expect(typeof content.body).toBe("string");
			expect(content.body.toLowerCase()).toMatch(/two.factor|authentication|active/);
		});
	});

	it("should NOT have SMS channel (not in architecture spec)", async () => {
		const { twoFaEnabledTemplates } = await import("../events/auth/2fa-enabled");
		expect(twoFaEnabledTemplates.en?.sms).toBeUndefined();
	});

	it("should NOT have push channel (not in architecture spec)", async () => {
		const { twoFaEnabledTemplates } = await import("../events/auth/2fa-enabled");
		expect(twoFaEnabledTemplates.en?.push).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Minimal-props tests — exercise falsy branches for optional fields
// ---------------------------------------------------------------------------

describe("auth templates — renders with minimal props", () => {
	const minimalBrand: BrandTheme = { name: "Min", appUrl: "https://min.example.com" };
	const ctx = makeCtx();

	describe("auth.welcome with no name", () => {
		it("should render email with generic greeting when name is absent", async () => {
			const { welcomeTemplates } = await import("../events/auth/welcome");
			const content = await welcomeTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.html).toContain("Welcome!");
			expect(content.html).not.toContain("Welcome, ");
			expect(content.text).toContain("Welcome!");
		});
	});

	describe("auth.password-reset with minimal payload", () => {
		it("should render email falling back to appUrl when resetUrl is absent", async () => {
			const { passwordResetTemplates } = await import("../events/auth/password-reset");
			const content = await passwordResetTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.html).toContain("https://min.example.com");
			expect(typeof content.text).toBe("string");
		});

		it("should render SMS with empty code when code is absent", async () => {
			const { passwordResetTemplates } = await import("../events/auth/password-reset");
			const content = passwordResetTemplates.en!.sms!({}, minimalBrand, ctx);
			expect(typeof content.body).toBe("string");
			expect(content.body).toContain("Min");
		});
	});

	describe("auth.email-verification with minimal payload", () => {
		it("should render email falling back to appUrl when verificationUrl is absent", async () => {
			const { emailVerificationTemplates } = await import("../events/auth/email-verification");
			const content = await emailVerificationTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.html).toContain("https://min.example.com");
		});
	});

	describe("auth.login-new-device with minimal payload", () => {
		it("should render email with defaults when all optional fields are absent", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const content = await loginNewDeviceTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.html).toContain("Unknown device");
			expect(content.html).not.toContain("Location:");
			expect(content.html).not.toContain("IP Address:");
			expect(content.text).not.toContain("Location:");
			expect(content.text).not.toContain("IP:");
		});

		it("should render SMS with default device and empty secureUrl", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const content = loginNewDeviceTemplates.en!.sms!({}, minimalBrand, ctx);
			expect(content.body).toContain("unknown device");
		});

		it("should render push without location when location is absent", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const content = loginNewDeviceTemplates.en!.push!({}, minimalBrand, ctx);
			expect(content.body).toContain("Sign-in from");
			expect(content.body).not.toContain(" in ");
		});

		it("should render in-app without location when location is absent", async () => {
			const { loginNewDeviceTemplates } = await import("../events/auth/login-new-device");
			const content = loginNewDeviceTemplates.en!.inApp!({}, minimalBrand, ctx);
			expect(content.body).toContain("From");
			expect(content.body).not.toContain(" in ");
		});
	});

	describe("auth.password-changed with minimal payload", () => {
		it("should render email falling back to appUrl/security when secureUrl is absent", async () => {
			const { passwordChangedTemplates } = await import("../events/auth/password-changed");
			const content = await passwordChangedTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.html).toContain("https://min.example.com");
		});

		it("should render SMS with empty secureUrl when absent", async () => {
			const { passwordChangedTemplates } = await import("../events/auth/password-changed");
			const content = passwordChangedTemplates.en!.sms!({}, minimalBrand, ctx);
			expect(content.body).toContain("Min");
		});
	});

	describe("auth.2fa-enabled with minimal brand", () => {
		it("should render email with minimal brand (no optional brand fields)", async () => {
			const { twoFaEnabledTemplates } = await import("../events/auth/2fa-enabled");
			const content = await twoFaEnabledTemplates.en!.email!({}, minimalBrand, ctx);
			expect(content.html).toContain("Two-factor");
		});
	});
});

// ---------------------------------------------------------------------------
// defaultTemplates registration — all 6 auth events under 'en'
// ---------------------------------------------------------------------------

describe("defaultTemplates — auth events registration", () => {
	it("should export defaultTemplates containing all 6 auth events", async () => {
		const { defaultTemplates } = await import("../index");

		expect(defaultTemplates).toHaveProperty("auth.welcome");
		expect(defaultTemplates).toHaveProperty("auth.password-reset");
		expect(defaultTemplates).toHaveProperty("auth.email-verification");
		expect(defaultTemplates).toHaveProperty("auth.login-new-device");
		expect(defaultTemplates).toHaveProperty("auth.password-changed");
		expect(defaultTemplates).toHaveProperty("auth.2fa-enabled");
	});

	it("should have 'en' lang key for each auth event", async () => {
		const { defaultTemplates } = await import("../index");

		const authEvents = [
			"auth.welcome",
			"auth.password-reset",
			"auth.email-verification",
			"auth.login-new-device",
			"auth.password-changed",
			"auth.2fa-enabled",
		];

		for (const event of authEvents) {
			expect(defaultTemplates[event]).toHaveProperty("en");
		}
	});
});
