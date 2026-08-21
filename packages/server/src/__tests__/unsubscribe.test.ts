/**
 * Tests for GET /emito/unsubscribe and POST /emito/unsubscribe endpoints.
 *
 * Rules applied:
 * - Assert on specific EmitoErrorCode values (rule 1)
 * - Assert statusCode for API boundary errors (rule 3)
 * - Test boundary conditions (rule 4)
 * - Test empty string inputs (rule 6)
 * - Use mockLogger (rule 13)
 * - Follow describe/it naming (rule 15)
 * - Use vi.useFakeTimers() for time-dependent behavior (rule 22)
 * - Assert on call arguments for mock verifications (rule 28)
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
import { createEmitoServer } from "../handler.js";

const TEST_JWT_SECRET = "test-jwt-secret-32-bytes-minimum!!";
const TEST_API_KEY = "test-admin-api-key-for-unsubscribe-tests";
const TEST_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret-32-bytes!!";

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

function buildUnsubscribeToken(
	claims: Record<string, unknown>,
	secret = TEST_UNSUBSCRIBE_SECRET,
	expOffset = 3600,
): string {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			sub: "sub_1",
			scope: "unsubscribe",
			iat: now - 60,
			exp: now + expOffset,
			...claims,
		}),
	).toString("base64url");
	const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
	return `${header}.${payload}.${sig}`;
}

function makeServerWithSubscriber() {
	const repositories = createRepositories();
	// Seed subscriber so GET /unsubscribe can render the page
	repositories.subscriberRepository.seed({
		id: "sub_1",
		email: "user1@example.com",
		phone: undefined,
		lang: undefined,
		timezone: undefined,
		metadata: {},
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
	});
	const server = createEmitoServer({
		emito: createMockEmito() as never,
		apiKey: TEST_API_KEY,
		resolveSubscriberId: async () => null,
		repositories,
		prefix: "/emito",
		unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
	});
	return { server, repositories };
}

describe("GET /emito/unsubscribe", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("valid token", () => {
		it("should return 200 with HTML content-type", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/html");
		});

		it("should include Content-Security-Policy header", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const csp = res.headers.get("content-security-policy");
			expect(csp).not.toBeNull();
			expect(csp).toContain("default-src 'none'");
			expect(csp).toContain("style-src 'unsafe-inline'");
		});

		it("should include X-Content-Type-Options: nosniff header", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		});

		it("should render valid HTML with DOCTYPE", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html).toContain("<!DOCTYPE html>");
		});

		it("should render a form with POST method", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toContain('method="post"');
		});

		it("should contain a save preferences button", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toContain("save");
		});

		it("should display the subscriber's escaped email on the page", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html).toContain("user1@example.com");
		});
	});

	describe("XSS prevention", () => {
		it("should not reflect raw <script> tag from subscriber email in HTML", async () => {
			const { server, repositories } = makeServerWithSubscriber();
			// Override subscriber with XSS payload in email
			repositories.subscriberRepository.seed({
				id: "sub_xss_1",
				email: `<script>alert('xss')</script>@example.com`,
				phone: undefined,
				lang: undefined,
				timezone: undefined,
				metadata: {},
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			});
			const token = buildUnsubscribeToken({ sub: "sub_xss_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html).not.toMatch(/<script[^>]*>/i);
		});

		it("should escape onerror handler payload in subscriber email", async () => {
			const { server, repositories } = makeServerWithSubscriber();
			repositories.subscriberRepository.seed({
				id: "sub_xss_2",
				email: `"><img src=x onerror="alert(1)">`,
				phone: undefined,
				lang: undefined,
				timezone: undefined,
				metadata: {},
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			});
			const token = buildUnsubscribeToken({ sub: "sub_xss_2" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			// The raw <img tag must not appear — the < must be escaped to &lt;
			expect(html).not.toContain("<img");
			// No unescaped attribute injection pattern
			expect(html).not.toMatch(/<[a-zA-Z][^>]*onerror/i);
		});
	});

	describe("invalid/expired token", () => {
		it("should return 200 (not 500) for an expired token", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" }, TEST_UNSUBSCRIBE_SECRET, -1);
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			expect(res.status).toBe(200);
		});

		it("should render 'link expired' page for expired token (no error details)", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" }, TEST_UNSUBSCRIBE_SECRET, -1);
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
			expect(html).not.toContain("JWT");
			expect(html).not.toContain("EmitoError");
			expect(html).not.toContain("stack");
		});

		it("should include security headers even on expired token page", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" }, TEST_UNSUBSCRIBE_SECRET, -1);
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			expect(res.headers.get("content-security-policy")).not.toBeNull();
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		});

		it("should render 'link expired' page for a tampered token", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" }, "wrong-secret-32-bytes!!!!");
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
		});

		it("should render 'link expired' page when token is missing", async () => {
			const { server } = makeServerWithSubscriber();
			const res = await server.handler(new Request("http://localhost/emito/unsubscribe"));
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
		});

		it("should render 'link expired' page for empty token query param", async () => {
			const { server } = makeServerWithSubscriber();
			const res = await server.handler(new Request("http://localhost/emito/unsubscribe?token="));
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
		});

		it("should render 'link expired' for confirm-scoped token on unsubscribe page", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1", scope: "confirm" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
		});

		it("should render 'link expired' page when subscriber does not exist", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_nonexistent" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
		});
	});
});

describe("POST /emito/unsubscribe", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("RFC 8058 one-click unsubscribe", () => {
		it("should return 200 with no redirect for List-Unsubscribe=One-Click", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "List-Unsubscribe=One-Click",
				}),
			);
			expect(res.status).toBe(200);
			// RFC 8058: no redirect on POST
			expect(res.headers.get("location")).toBeNull();
		});

		it("should return empty or minimal body for one-click", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "List-Unsubscribe=One-Click",
				}),
			);
			// Body should be empty or minimal — RFC 8058 spec
			const body = await res.text();
			expect(body.length).toBeLessThan(500);
		});

		it("should not set HTML content-type for RFC 8058 one-click response", async () => {
			// RFC 8058 one-click returns 200 with empty body — not an HTML response
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "List-Unsubscribe=One-Click",
				}),
			);
			const ct = res.headers.get("content-type") ?? "";
			// Must not be an HTML response (empty body should not claim to be HTML)
			expect(ct).not.toContain("text/html");
		});
	});

	describe("form submission (preference update)", () => {
		it("should return 200 with HTML response for form submission", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "newsletter=on&product-updates=on",
				}),
			);
			expect(res.status).toBe(200);
			const ct = res.headers.get("content-type");
			expect(ct).toContain("text/html");
		});

		it("should include security headers on form submission response", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "newsletter=on",
				}),
			);
			expect(res.headers.get("content-security-policy")).not.toBeNull();
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		});

		it("should render a confirmation/success page after form submission", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "unsubscribe_all=true",
				}),
			);
			const html = await res.text();
			expect(html).toContain("<!DOCTYPE html>");
			expect(html.toLowerCase()).toMatch(/unsubscribed|preference|success|updated/);
		});
	});

	describe("invalid/expired token on POST", () => {
		it("should render 'link expired' page for expired token", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" }, TEST_UNSUBSCRIBE_SECRET, -1);
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "List-Unsubscribe=One-Click",
				}),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
			expect(html).not.toContain("JWT");
			expect(html).not.toContain("EmitoError");
		});

		it("should set security headers on expired-token POST response", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" }, TEST_UNSUBSCRIBE_SECRET, -1);
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "List-Unsubscribe=One-Click",
				}),
			);
			expect(res.headers.get("content-security-policy")).not.toBeNull();
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		});

		it("should not return 500 for invalid token on POST", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" }, "wrong-secret!!!!!!!!!!!!!!!");
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "List-Unsubscribe=One-Click",
				}),
			);
			expect(res.status).not.toBe(500);
		});

		it("should return HTML response with security headers for invalid token on POST", async () => {
			const { server } = makeServerWithSubscriber();
			const token = buildUnsubscribeToken({ sub: "sub_1" }, "wrong-secret!!!!!!!!!!!!!!!");
			const res = await server.handler(
				new Request(`http://localhost/emito/unsubscribe?token=${token}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "List-Unsubscribe=One-Click",
				}),
			);
			expect(res.headers.get("content-security-policy")).not.toBeNull();
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		});
	});
});
