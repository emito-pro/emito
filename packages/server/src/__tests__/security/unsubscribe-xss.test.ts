/**
 * Security tests: XSS prevention for server-rendered unsubscribe and confirm pages.
 *
 * Per agent-rules.md rule 18: security tests are mandatory for token-related code.
 * Per security.md: XSS Prevention section — all subscriber-derived content must be escaped.
 *
 * Rules applied:
 * - Use vi.useFakeTimers() for time-dependent behavior (rule 22)
 * - Prefer specific matchers (rule 25)
 * - Assert on shape of return values (rule 26)
 */

import { createHmac } from "node:crypto";
import {
	InMemoryConsentRepository,
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemorySubscriberRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "@emito/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitoServer } from "../../handler.js";

const TEST_JWT_SECRET = "test-jwt-secret-32-bytes-minimum!!";
const TEST_API_KEY = "test-admin-api-key-xss-tests";
const TEST_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret-32-bytes!!";

/** Various XSS payloads to test against */
const XSS_PAYLOADS = [
	`<script>alert('xss')</script>`,
	`<img src=x onerror="alert(1)">`,
	`"><script>alert(document.cookie)</script>`,
	`' onmouseover='alert(1)`,
	`<svg onload="alert(1)">`,
	`<body onload="alert(1)">`,
	"javascript:alert(1)",
];

function createMockEmito() {
	return {
		send: vi.fn().mockResolvedValue({ status: "delivered" }),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		healthCheck: vi
			.fn()
			.mockResolvedValue({ healthy: true, providers: [], redis: { connected: true } }),
		on: vi.fn(),
		off: vi.fn(),
	};
}

function createRepositories() {
	return {
		subscriberRepository: new InMemorySubscriberRepository(),
		notificationRepository: new InMemoryNotificationRepository(),
		preferenceRepository: new InMemoryPreferenceRepository(),
		consentRepository: new InMemoryConsentRepository(),
		workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
		suppressionRepository: new InMemorySuppressionRepository(),
		deadLetterRepository: new InMemoryDeadLetterRepository(),
		integrationRepository: new InMemoryIntegrationRepository(),
		inboxRepository: new InMemoryInboxRepository(),
	};
}

function createListMemberConfirmMock() {
	return {
		confirmMembership: vi.fn().mockResolvedValue({ alreadyConfirmed: false }),
	};
}

function buildToken(
	claims: Record<string, unknown>,
	secret = TEST_UNSUBSCRIBE_SECRET,
	expOffset = 3600,
): string {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			iat: now - 60,
			exp: now + expOffset,
			...claims,
		}),
	).toString("base64url");
	const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
	return `${header}.${payload}.${sig}`;
}

function makeServerWithSubscriber(subscriberEmail = "user@example.com") {
	const repositories = createRepositories();
	repositories.subscriberRepository.seed({
		id: "sub_1",
		email: subscriberEmail,
		phone: undefined,
		lang: undefined,
		timezone: undefined,
		metadata: {},
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
	});
	return createEmitoServer({
		emito: createMockEmito() as never,
		apiKey: TEST_API_KEY,
		resolveSubscriberId: async () => null,
		repositories,
		prefix: "/emito",
		unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
		listMemberConfirm: createListMemberConfirmMock(),
	});
}

describe("XSS Prevention — unsubscribe page", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should not reflect <script> payloads from subscriber email in GET response", async () => {
		for (const payload of XSS_PAYLOADS) {
			const server = makeServerWithSubscriber(payload);
			const token = buildToken({ sub: "sub_1", scope: "unsubscribe" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			// Raw <script> tag must never appear in rendered output
			expect(html, `Payload: ${payload}`).not.toMatch(/<script[^>]*>/i);
			// No unescaped HTML attribute injection (e.g. <img onerror=...)
			expect(html, `Payload: ${payload}`).not.toMatch(/<[a-zA-Z][^>]*onerror/i);
			expect(html, `Payload: ${payload}`).not.toMatch(/<[a-zA-Z][^>]*onload/i);
		}
	});

	it("should not reflect <script> payloads from list claim in GET response", async () => {
		for (const payload of XSS_PAYLOADS) {
			const server = makeServerWithSubscriber();
			const token = buildToken({ sub: "sub_1", scope: "unsubscribe", list: payload });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html, `Payload: ${payload}`).not.toMatch(/<script[^>]*>/i);
			expect(html, `Payload: ${payload}`).not.toMatch(/<[a-zA-Z][^>]*onerror/i);
		}
	});

	it("should set CSP header that blocks inline script execution", async () => {
		const server = makeServerWithSubscriber();
		const token = buildToken({ sub: "sub_1", scope: "unsubscribe" });
		const res = await server.handler(
			new Request(`http://localhost/emito/unsubscribe?token=${token}`),
		);
		const csp = res.headers.get("content-security-policy") ?? "";
		// CSP must block scripts (default-src 'none')
		expect(csp).toContain("default-src 'none'");
		// Must NOT include 'unsafe-eval' for scripts
		expect(csp).not.toContain("'unsafe-eval'");
		// style-src unsafe-inline is permitted for inline styles only
		expect(csp).toContain("style-src 'unsafe-inline'");
		// form-action should be restricted to self
		expect(csp).toContain("form-action 'self'");
	});

	it("should set X-Content-Type-Options to prevent MIME sniffing", async () => {
		const server = makeServerWithSubscriber();
		const token = buildToken({ sub: "sub_1", scope: "unsubscribe" });
		const res = await server.handler(
			new Request(`http://localhost/emito/unsubscribe?token=${token}`),
		);
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("should also set security headers on the expired link page", async () => {
		const server = makeServerWithSubscriber();
		const token = buildToken({ sub: "sub_1", scope: "unsubscribe" }, TEST_UNSUBSCRIBE_SECRET, -1);
		const res = await server.handler(
			new Request(`http://localhost/emito/unsubscribe?token=${token}`),
		);
		expect(res.headers.get("content-security-policy")).not.toBeNull();
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});
});

describe("XSS Prevention — confirm page", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should not reflect <script> payloads from list claim on POST /confirm", async () => {
		for (const payload of XSS_PAYLOADS) {
			const server = makeServerWithSubscriber();
			const token = buildToken({
				sub: "sub_1",
				scope: "confirm",
				list: payload,
			});
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			const html = await res.text();
			expect(html, `Payload: ${payload}`).not.toMatch(/<script[^>]*>/i);
			expect(html, `Payload: ${payload}`).not.toMatch(/<[a-zA-Z][^>]*onerror/i);
			expect(html, `Payload: ${payload}`).not.toMatch(/<[a-zA-Z][^>]*onload/i);
		}
	});

	it("should set CSP and X-Content-Type-Options on confirm page", async () => {
		const server = makeServerWithSubscriber();
		const token = buildToken({ sub: "sub_1", scope: "confirm", list: "newsletter" });
		const res = await server.handler(
			new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
		);
		const csp = res.headers.get("content-security-policy") ?? "";
		expect(csp).toContain("default-src 'none'");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("should also set security headers on the confirm expired link page", async () => {
		const server = makeServerWithSubscriber();
		const token = buildToken(
			{ sub: "sub_1", scope: "confirm", list: "newsletter" },
			TEST_UNSUBSCRIBE_SECRET,
			-1,
		);
		const res = await server.handler(
			new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
		);
		expect(res.headers.get("content-security-policy")).not.toBeNull();
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});
});

describe("Token scope isolation — no cross-use between scopes", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should not accept a confirm-scoped token on the unsubscribe endpoint", async () => {
		const server = makeServerWithSubscriber();
		const token = buildToken({ sub: "sub_1", scope: "confirm", list: "newsletter" });
		const res = await server.handler(
			new Request(`http://localhost/emito/unsubscribe?token=${token}`),
		);
		const html = await res.text();
		// Must show expired/invalid page, not the preference page
		expect(html.toLowerCase()).toMatch(/expired|invalid/);
	});

	it("should not accept an unsubscribe-scoped token on the confirm endpoint", async () => {
		const server = makeServerWithSubscriber();
		const token = buildToken({ sub: "sub_1", scope: "unsubscribe" });
		const res = await server.handler(
			new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
		);
		const html = await res.text();
		expect(html.toLowerCase()).toMatch(/expired|invalid/);
	});
});

describe("Token validation — information leakage prevention", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should not leak error details when unsubscribe token is invalid", async () => {
		const server = makeServerWithSubscriber();
		const token = "invalid.jwt.token";
		const res = await server.handler(
			new Request(`http://localhost/emito/unsubscribe?token=${token}`),
		);
		const html = await res.text();
		expect(html).not.toContain("EmitoError");
		expect(html).not.toContain("Error:");
		expect(html).not.toContain("JWT");
		expect(html).not.toContain("stack");
		expect(html).not.toContain(TEST_UNSUBSCRIBE_SECRET);
	});

	it("should not leak error details when confirm token is invalid", async () => {
		const server = makeServerWithSubscriber();
		const token = "invalid.jwt.token";
		const res = await server.handler(
			new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
		);
		const html = await res.text();
		expect(html).not.toContain("EmitoError");
		expect(html).not.toContain("Error:");
		expect(html).not.toContain("JWT");
		expect(html).not.toContain("stack");
		expect(html).not.toContain(TEST_UNSUBSCRIBE_SECRET);
	});
});
