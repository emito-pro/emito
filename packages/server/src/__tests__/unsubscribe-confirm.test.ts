/**
 * Tests for unsubscribe page (GET/POST), RFC 8058 one-click unsubscribe,
 * double opt-in confirmation, token validation, and XSS prevention.
 */

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerConfirmEndpoint } from "../endpoints/confirm/index.js";
import type { ListMemberConfirm } from "../endpoints/confirm/index.js";
import { registerUnsubscribeEndpoints } from "../endpoints/unsubscribe/index.js";
import { validateToken } from "../endpoints/unsubscribe/token.js";
import { htmlEscape } from "../html/escape.js";
import { html, htmlPage, htmlResponse } from "../html/render.js";
import { createRouter } from "../router.js";

// --- Helpers ---

const TEST_SECRET = "test-secret-at-least-32-bytes-long!!";

function signJwt(payload: Record<string, unknown>, secret: string = TEST_SECRET): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${sig}`;
}

function makeUnsubscribeToken(
	overrides: Partial<{
		sub: string;
		scope: string;
		list: string;
		topic: string;
		cat: string;
		exp: number;
	}> = {},
): string {
	const now = Math.floor(Date.now() / 1000);
	return signJwt({
		sub: "sub_123",
		scope: "unsubscribe",
		iat: now,
		exp: now + 86400, // 1 day
		...overrides,
	});
}

function makeConfirmToken(
	overrides: Partial<{
		sub: string;
		scope: string;
		list: string;
		exp: number;
	}> = {},
): string {
	const now = Math.floor(Date.now() / 1000);
	return signJwt({
		sub: "sub_123",
		scope: "confirm",
		list: "newsletter",
		iat: now,
		exp: now + 172800, // 48h
		...overrides,
	});
}

function makeRouter(prefix = "/emito") {
	return createRouter(prefix);
}

function mockSubscriberRepository() {
	return {
		findById: vi.fn().mockResolvedValue({
			id: "sub_123",
			email: "user@example.com",
		}),
		findByIds: vi.fn().mockResolvedValue([]),
		create: vi.fn(),
		upsert: vi.fn(),
		update: vi.fn(),
		list: vi.fn(),
		erase: vi.fn(),
	};
}

function mockPreferenceRepository() {
	return {
		findBySubscriber: vi.fn().mockResolvedValue([
			{ topicKey: "newsletter", channel: "email", enabled: true },
			{ topicKey: "promotions", channel: "email", enabled: false },
		]),
		listBySubscriber: vi.fn(),
		upsert: vi.fn().mockResolvedValue({}),
		reset: vi.fn(),
		listByWorkspace: vi.fn(),
	};
}

function mockListMemberConfirm(): ListMemberConfirm & {
	confirmMembership: ReturnType<typeof vi.fn>;
} {
	return {
		confirmMembership: vi.fn().mockResolvedValue({ alreadyConfirmed: false }),
	};
}

// ---------------------------------------------------------------------------
// htmlEscape
// ---------------------------------------------------------------------------

describe("htmlEscape", () => {
	it("should escape & < > \" '", () => {
		expect(htmlEscape("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#x27;");
	});

	it("should not modify safe strings", () => {
		expect(htmlEscape("hello world")).toBe("hello world");
	});

	it("should escape script tags", () => {
		expect(htmlEscape('<script>alert("xss")</script>')).toBe(
			"&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
		);
	});

	it("should handle empty string", () => {
		expect(htmlEscape("")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// html tagged template
// ---------------------------------------------------------------------------

describe("html tagged template", () => {
	it("should escape interpolated values", () => {
		const userInput = '<script>alert("xss")</script>';
		const result = html`<p>${userInput}</p>`;
		expect(result).toContain("&lt;script&gt;");
		expect(result).not.toContain("<script>");
	});

	it("should not escape static template parts", () => {
		const result = html`<div class="test">safe</div>`;
		expect(result).toContain('<div class="test">');
	});
});

// ---------------------------------------------------------------------------
// htmlPage
// ---------------------------------------------------------------------------

describe("htmlPage", () => {
	it("should produce valid HTML document", () => {
		const result = htmlPage("Test", html`<p>Body</p>`);
		expect(result).toContain("<!DOCTYPE html>");
		expect(result).toContain("<title>Test</title>");
		expect(result).toContain("<p>Body</p>");
	});

	it("should escape the title", () => {
		const result = htmlPage('<script>alert("xss")</script>', html`body`);
		expect(result).toContain("&lt;script&gt;");
		expect(result).not.toContain("<script>alert");
	});

	it("should include CSP meta tag", () => {
		const result = htmlPage("Test", html`body`);
		expect(result).toContain("Content-Security-Policy");
		expect(result).toContain("default-src 'none'");
	});
});

// ---------------------------------------------------------------------------
// htmlResponse
// ---------------------------------------------------------------------------

describe("htmlResponse", () => {
	it("should set security headers", () => {
		const res = htmlResponse("<p>test</p>");
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("should use custom status code", () => {
		const res = htmlResponse("<p>test</p>", 404);
		expect(res.status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// validateToken
// ---------------------------------------------------------------------------

describe("validateToken", () => {
	it("should return payload for valid unsubscribe token", () => {
		const token = makeUnsubscribeToken();
		const result = validateToken(token, TEST_SECRET, "unsubscribe");
		expect(result).not.toBeNull();
		expect(result!.sub).toBe("sub_123");
		expect(result!.scope).toBe("unsubscribe");
	});

	it("should return payload for valid confirm token", () => {
		const token = makeConfirmToken();
		const result = validateToken(token, TEST_SECRET, "confirm");
		expect(result).not.toBeNull();
		expect(result!.sub).toBe("sub_123");
		expect(result!.scope).toBe("confirm");
		expect(result!.list).toBe("newsletter");
	});

	it("should return null for expired token", () => {
		const token = makeUnsubscribeToken({ exp: Math.floor(Date.now() / 1000) - 100 });
		expect(validateToken(token, TEST_SECRET, "unsubscribe")).toBeNull();
	});

	it("should return null for wrong scope", () => {
		const token = makeUnsubscribeToken(); // scope: "unsubscribe"
		expect(validateToken(token, TEST_SECRET, "confirm")).toBeNull();
	});

	it("should return null for wrong secret", () => {
		const token = makeUnsubscribeToken();
		expect(validateToken(token, "wrong-secret-that-is-long-enough", "unsubscribe")).toBeNull();
	});

	it("should return null for malformed token", () => {
		expect(validateToken("not.a.valid-token", TEST_SECRET, "unsubscribe")).toBeNull();
		expect(validateToken("", TEST_SECRET, "unsubscribe")).toBeNull();
		expect(validateToken("only-one-part", TEST_SECRET, "unsubscribe")).toBeNull();
	});

	it("should return null for missing sub field", () => {
		const now = Math.floor(Date.now() / 1000);
		const token = signJwt({ scope: "unsubscribe", iat: now, exp: now + 3600 });
		expect(validateToken(token, TEST_SECRET, "unsubscribe")).toBeNull();
	});

	it("should reject non-HS256 algorithms", () => {
		const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
		const body = Buffer.from(
			JSON.stringify({
				sub: "sub_123",
				scope: "unsubscribe",
				exp: Math.floor(Date.now() / 1000) + 3600,
			}),
		).toString("base64url");
		const token = `${header}.${body}.`;
		expect(validateToken(token, TEST_SECRET, "unsubscribe")).toBeNull();
	});

	it("should prevent cross-use between unsubscribe and confirm", () => {
		const unsubToken = makeUnsubscribeToken();
		const confirmToken = makeConfirmToken();
		expect(validateToken(unsubToken, TEST_SECRET, "confirm")).toBeNull();
		expect(validateToken(confirmToken, TEST_SECRET, "unsubscribe")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Unsubscribe GET endpoint
// ---------------------------------------------------------------------------

describe("GET /emito/unsubscribe", () => {
	function setup() {
		const router = makeRouter();
		const subscriberRepo = mockSubscriberRepository();
		const preferenceRepo = mockPreferenceRepository();
		registerUnsubscribeEndpoints(router, {
			subscriberRepository: subscriberRepo,
			preferenceRepository: preferenceRepo,
			unsubscribeSecret: TEST_SECRET,
		});
		return { router, subscriberRepo, preferenceRepo };
	}

	it("should render preference page for valid token", async () => {
		const { router } = setup();
		const token = makeUnsubscribeToken();
		const match = router.match("GET", "/emito/unsubscribe");
		expect(match).not.toBeNull();

		const ctx = {
			params: {},
			query: { token },
			body: undefined,
		};
		const res = await match!.route.handler(ctx as never, new Request("http://localhost"));
		expect(res.status).toBe(200);

		const body = await res.text();
		expect(body).toContain("Manage your email preferences");
		expect(body).toContain("user@example.com");
		expect(body).toContain("newsletter");
	});

	it("should set security headers", async () => {
		const { router } = setup();
		const token = makeUnsubscribeToken();
		const match = router.match("GET", "/emito/unsubscribe")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));

		expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("should render expired page for invalid token", async () => {
		const { router } = setup();
		const match = router.match("GET", "/emito/unsubscribe")!;

		const ctx = { params: {}, query: { token: "invalid.token.here" }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		expect(res.status).toBe(200);

		const body = await res.text();
		expect(body).toContain("This link has expired");
		expect(body).not.toContain("invalid.token.here");
	});

	it("should render expired page when no token provided", async () => {
		const { router } = setup();
		const match = router.match("GET", "/emito/unsubscribe")!;

		const ctx = { params: {}, query: {}, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).toContain("This link has expired");
	});

	it("should render expired page for expired token", async () => {
		const { router } = setup();
		const token = makeUnsubscribeToken({ exp: Math.floor(Date.now() / 1000) - 100 });
		const match = router.match("GET", "/emito/unsubscribe")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).toContain("This link has expired");
	});

	it("should render expired page when subscriber not found", async () => {
		const { router, subscriberRepo } = setup();
		subscriberRepo.findById.mockResolvedValue(null);
		const token = makeUnsubscribeToken();
		const match = router.match("GET", "/emito/unsubscribe")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).toContain("This link has expired");
	});

	it("should escape subscriber email to prevent XSS", async () => {
		const { router, subscriberRepo } = setup();
		subscriberRepo.findById.mockResolvedValue({
			id: "sub_123",
			email: '<script>alert("xss")</script>@evil.com',
		});
		const token = makeUnsubscribeToken();
		const match = router.match("GET", "/emito/unsubscribe")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).not.toContain("<script>");
		expect(body).toContain("&lt;script&gt;");
	});

	it("should escape topic keys to prevent XSS", async () => {
		const { router, preferenceRepo } = setup();
		preferenceRepo.findBySubscriber.mockResolvedValue([
			{ topicKey: '<img src=x onerror="alert(1)">', channel: "email", enabled: true },
		]);
		const token = makeUnsubscribeToken();
		const match = router.match("GET", "/emito/unsubscribe")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).not.toContain("<img src=x");
		expect(body).toContain("&lt;img");
	});
});

// ---------------------------------------------------------------------------
// Unsubscribe POST endpoint
// ---------------------------------------------------------------------------

describe("POST /emito/unsubscribe", () => {
	function setup() {
		const router = makeRouter();
		const subscriberRepo = mockSubscriberRepository();
		const preferenceRepo = mockPreferenceRepository();
		registerUnsubscribeEndpoints(router, {
			subscriberRepository: subscriberRepo,
			preferenceRepository: preferenceRepo,
			unsubscribeSecret: TEST_SECRET,
		});
		return { router, subscriberRepo, preferenceRepo };
	}

	it("should process RFC 8058 one-click unsubscribe", async () => {
		const { router, preferenceRepo } = setup();
		const token = makeUnsubscribeToken({ topic: "newsletter" });
		const match = router.match("POST", "/emito/unsubscribe")!;

		const ctx = {
			params: {},
			query: { token },
			body: undefined,
			rawBody: "List-Unsubscribe=One-Click",
		};
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		expect(res.status).toBe(200);

		// Should have updated preferences
		expect(preferenceRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
	});

	it("should return 200 with empty body for one-click", async () => {
		const { router } = setup();
		const token = makeUnsubscribeToken({ topic: "newsletter" });
		const match = router.match("POST", "/emito/unsubscribe")!;

		const ctx = {
			params: {},
			query: { token },
			body: undefined,
			rawBody: "List-Unsubscribe=One-Click",
		};
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toBe("");
	});

	it("should process unsubscribe-all form submission", async () => {
		const { router, preferenceRepo } = setup();
		const token = makeUnsubscribeToken();
		const match = router.match("POST", "/emito/unsubscribe")!;

		const ctx = {
			params: {},
			query: { token },
			body: undefined,
			rawBody: "unsubscribe_all=true",
		};
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		expect(res.status).toBe(200);

		const body = await res.text();
		expect(body).toContain("unsubscribed from all");

		// Should disable all existing preferences
		expect(preferenceRepo.upsert).toHaveBeenCalledTimes(2);
		for (const call of preferenceRepo.upsert.mock.calls) {
			expect(call[0]).toEqual(expect.objectContaining({ enabled: false }));
		}
	});

	it("should process preference form submission", async () => {
		const { router, preferenceRepo } = setup();
		const token = makeUnsubscribeToken();
		const match = router.match("POST", "/emito/unsubscribe")!;

		// Only "newsletter" checkbox is checked, "promotions" is not
		const ctx = {
			params: {},
			query: { token },
			body: undefined,
			rawBody: "pref_newsletter_email=on",
		};
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		expect(res.status).toBe(200);

		const body = await res.text();
		expect(body).toContain("updated");

		// newsletter enabled, promotions disabled
		expect(preferenceRepo.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ topicKey: "newsletter", enabled: true }),
		);
		expect(preferenceRepo.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ topicKey: "promotions", enabled: false }),
		);
	});

	it("should render expired page for invalid token on POST", async () => {
		const { router } = setup();
		const match = router.match("POST", "/emito/unsubscribe")!;

		const ctx = {
			params: {},
			query: { token: "invalid" },
			body: undefined,
			rawBody: "List-Unsubscribe=One-Click",
		};
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).toContain("This link has expired");
	});

	it("should render expired page when no token on POST", async () => {
		const { router } = setup();
		const match = router.match("POST", "/emito/unsubscribe")!;

		const ctx = {
			params: {},
			query: {},
			body: undefined,
			rawBody: "List-Unsubscribe=One-Click",
		};
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).toContain("This link has expired");
	});
});

// ---------------------------------------------------------------------------
// Confirm POST endpoint
// ---------------------------------------------------------------------------

describe("POST /emito/confirm", () => {
	function setup() {
		const router = makeRouter();
		const listMemberConfirm = mockListMemberConfirm();
		registerConfirmEndpoint(router, {
			listMemberConfirm,
			unsubscribeSecret: TEST_SECRET,
			prefix: "/emito",
		});
		return { router, listMemberConfirm };
	}

	it("should confirm subscription with valid token", async () => {
		const { router, listMemberConfirm } = setup();
		const token = makeConfirmToken();
		const match = router.match("POST", "/emito/confirm")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		expect(res.status).toBe(200);

		const body = await res.text();
		expect(body).toContain("You're subscribed!");
		expect(body).toContain("newsletter");

		expect(listMemberConfirm.confirmMembership).toHaveBeenCalledWith("sub_123", "newsletter");
	});

	it("should render expired page for expired confirm token", async () => {
		const { router } = setup();
		const token = makeConfirmToken({ exp: Math.floor(Date.now() / 1000) - 100 });
		const match = router.match("POST", "/emito/confirm")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).toContain("This link has expired");
	});

	it("should render expired page for wrong scope (unsubscribe token used on confirm)", async () => {
		const { router } = setup();
		const token = makeUnsubscribeToken(); // scope: "unsubscribe", not "confirm"
		const match = router.match("POST", "/emito/confirm")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).toContain("This link has expired");
	});

	it("should render expired page when no token", async () => {
		const { router } = setup();
		const match = router.match("POST", "/emito/confirm")!;

		const ctx = { params: {}, query: {}, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).toContain("This link has expired");
	});

	it("should render expired page when token has no list claim", async () => {
		const { router } = setup();
		const now = Math.floor(Date.now() / 1000);
		const token = signJwt({ sub: "sub_123", scope: "confirm", iat: now, exp: now + 3600 });
		const match = router.match("POST", "/emito/confirm")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).toContain("This link has expired");
	});

	it("should be idempotent — already confirmed shows success", async () => {
		const { router, listMemberConfirm } = setup();
		listMemberConfirm.confirmMembership.mockResolvedValue({ alreadyConfirmed: true });
		const token = makeConfirmToken();
		const match = router.match("POST", "/emito/confirm")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		expect(res.status).toBe(200);

		const body = await res.text();
		expect(body).toContain("You're subscribed!");
	});

	it("should escape list name to prevent XSS", async () => {
		const { router } = setup();
		const token = makeConfirmToken({ list: '<script>alert("xss")</script>' });
		const match = router.match("POST", "/emito/confirm")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		const body = await res.text();
		expect(body).not.toContain("<script>");
		expect(body).toContain("&lt;script&gt;");
	});

	it("should set security headers on confirmation page", async () => {
		const { router } = setup();
		const token = makeConfirmToken();
		const match = router.match("POST", "/emito/confirm")!;

		const ctx = { params: {}, query: { token }, body: undefined };
		const res = await match.route.handler(ctx as never, new Request("http://localhost"));
		expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});
});

// ---------------------------------------------------------------------------
// Stub removal verification
// ---------------------------------------------------------------------------

describe("stub removal", () => {
	it("should not register stubs for unsubscribe/confirm routes", async () => {
		// Import stubs directly and verify the removed routes
		const { registerStubEndpoints } = await import("../endpoints/stubs.js");
		const router = makeRouter();
		registerStubEndpoints(router);

		// These should NOT be registered as stubs anymore
		expect(router.match("GET", "/emito/unsubscribe")).toBeNull();
		expect(router.match("POST", "/emito/unsubscribe")).toBeNull();
		expect(router.match("POST", "/emito/confirm")).toBeNull();
	});
});
