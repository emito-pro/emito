/**
 * Tests for POST /emito/confirm endpoint (double opt-in confirmation).
 *
 * Rules applied:
 * - Assert on specific EmitoErrorCode values (rule 1)
 * - Assert statusCode for API boundary errors (rule 3)
 * - Test boundary conditions (rule 4)
 * - Test empty string inputs (rule 6)
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
import { validateToken } from "../endpoints/unsubscribe/token.js";
import { createEmitoServer } from "../handler.js";

const TEST_JWT_SECRET = "test-jwt-secret-32-bytes-minimum!!";
const TEST_API_KEY = "test-admin-api-key-for-confirm-tests";
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

function createListMemberConfirmMock() {
	return {
		confirmMembership: vi.fn().mockResolvedValue({ alreadyConfirmed: false }),
	};
}

function buildConfirmToken(
	claims: Record<string, unknown>,
	secret = TEST_UNSUBSCRIBE_SECRET,
	expOffset = 172800, // 48h
): string {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			sub: "sub_1",
			scope: "confirm",
			list: "newsletter",
			iat: now - 60,
			exp: now + expOffset,
			...claims,
		}),
	).toString("base64url");
	const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
	return `${header}.${payload}.${sig}`;
}

function makeServer(listMemberConfirmMock = createListMemberConfirmMock()) {
	return {
		server: createEmitoServer({
			emito: createMockEmito() as never,
			apiKey: TEST_API_KEY,
			resolveSubscriberId: async () => null,
			repositories: createRepositories(),
			prefix: "/emito",
			unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
			listMemberConfirm: listMemberConfirmMock,
		}),
		listMemberConfirmMock,
	};
}

describe("POST /emito/confirm", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("valid confirm token", () => {
		it("should return 200 for a valid confirm token", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1", scope: "confirm", list: "newsletter" });
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(res.status).toBe(200);
		});

		it("should return HTML content-type", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(res.headers.get("content-type")).toContain("text/html");
		});

		it("should include Content-Security-Policy header", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			const csp = res.headers.get("content-security-policy");
			expect(csp).not.toBeNull();
			expect(csp).toContain("default-src 'none'");
		});

		it("should include X-Content-Type-Options: nosniff header", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1" });
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		});

		it("should render a confirmation success page", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1", list: "newsletter" });
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			const html = await res.text();
			expect(html).toContain("<!DOCTYPE html>");
			expect(html.toLowerCase()).toMatch(/subscribed|confirmed|success/);
		});

		it("should include a working manage-preferences link on the confirmation page", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1", list: "newsletter" });
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			const html = await res.text();

			const hrefMatch = html.match(/<a href="([^"]*\/unsubscribe\?token=[^"]*)"/);
			expect(hrefMatch).not.toBeNull();
			const href = hrefMatch![1]!;
			expect(href).toMatch(/^\/emito\/unsubscribe\?token=/);

			// The generated token must itself be valid and carry the confirming subscriber's id.
			const linkToken = href.split("token=")[1]!;
			const linkPayload = validateToken(linkToken, TEST_UNSUBSCRIBE_SECRET, "unsubscribe");
			expect(linkPayload).not.toBeNull();
			expect(linkPayload!.sub).toBe("sub_1");
		});

		it("should call confirmMembership with the correct subscriber and list", async () => {
			const { server, listMemberConfirmMock } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1", list: "newsletter" });
			await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(listMemberConfirmMock.confirmMembership).toHaveBeenCalledWith("sub_1", "newsletter");
		});

		it("should be idempotent: re-confirming already confirmed returns 200", async () => {
			const confirmMock = {
				confirmMembership: vi
					.fn()
					.mockResolvedValueOnce({ alreadyConfirmed: false })
					.mockResolvedValueOnce({ alreadyConfirmed: true }),
			};
			const { server } = makeServer(confirmMock);
			const token = buildConfirmToken({ sub: "sub_1", list: "newsletter" });

			// First confirmation
			const res1 = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(res1.status).toBe(200);

			// Second confirmation (same token, idempotent)
			const res2 = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(res2.status).toBe(200);
			const html = await res2.text();
			expect(html.toLowerCase()).toMatch(/subscribed|confirmed|success/);
		});
	});

	describe("invalid/expired token", () => {
		it("should return 200 (not 500) for expired confirm token", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1" }, TEST_UNSUBSCRIBE_SECRET, -1);
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(res.status).toBe(200);
		});

		it("should render 'link expired' page for expired confirm token", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1" }, TEST_UNSUBSCRIBE_SECRET, -1);
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
			expect(html).not.toContain("JWT");
			expect(html).not.toContain("EmitoError");
			expect(html).not.toContain("stack");
		});

		it("should include security headers on expired token page", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1" }, TEST_UNSUBSCRIBE_SECRET, -1);
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(res.headers.get("content-security-policy")).not.toBeNull();
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		});

		it("should render 'link expired' for tampered confirm token", async () => {
			const { server } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1" }, "wrong-secret!!!!!!!!!!!!!!!!");
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
		});

		it("should render 'link expired' when token is missing", async () => {
			const { server } = makeServer();
			const res = await server.handler(
				new Request("http://localhost/emito/confirm", { method: "POST" }),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
		});

		it("should render 'link expired' for unsubscribe-scoped token on confirm endpoint", async () => {
			const { server } = makeServer();
			// Build unsubscribe-scoped token — wrong scope for /confirm
			const now = Math.floor(Date.now() / 1000);
			const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
				"base64url",
			);
			const payload = Buffer.from(
				JSON.stringify({
					sub: "sub_1",
					scope: "unsubscribe", // wrong scope for /confirm
					list: "newsletter",
					iat: now - 60,
					exp: now + 3600,
				}),
			).toString("base64url");
			const sig = createHmac("sha256", TEST_UNSUBSCRIBE_SECRET)
				.update(`${header}.${payload}`)
				.digest("base64url");
			const token = `${header}.${payload}.${sig}`;

			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
		});

		it("should render 'link expired' when confirm token has no list claim", async () => {
			const { server } = makeServer();
			// Build a token without the list claim
			const now = Math.floor(Date.now() / 1000);
			const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
				"base64url",
			);
			const payload = Buffer.from(
				JSON.stringify({
					sub: "sub_1",
					scope: "confirm",
					// no list claim
					iat: now - 60,
					exp: now + 172800,
				}),
			).toString("base64url");
			const sig = createHmac("sha256", TEST_UNSUBSCRIBE_SECRET)
				.update(`${header}.${payload}`)
				.digest("base64url");
			const token = `${header}.${payload}.${sig}`;

			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			const html = await res.text();
			expect(html.toLowerCase()).toMatch(/expired|invalid/);
		});

		it("should not call confirmMembership for an invalid token", async () => {
			const { server, listMemberConfirmMock } = makeServer();
			const token = buildConfirmToken({ sub: "sub_1" }, "wrong-secret!!!!!!!!!!!!!!!!!");
			await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(listMemberConfirmMock.confirmMembership).not.toHaveBeenCalled();
		});
	});

	describe("confirm endpoint not registered without listMemberConfirm", () => {
		it("should return 404 when listMemberConfirm is not configured (route not registered)", async () => {
			// Server without listMemberConfirm — confirm route is conditionally not registered
			const server = createEmitoServer({
				emito: createMockEmito() as never,
				apiKey: TEST_API_KEY,
				resolveSubscriberId: async () => null,
				repositories: createRepositories(),
				prefix: "/emito",
				unsubscribeSecret: TEST_UNSUBSCRIBE_SECRET,
				// listMemberConfirm intentionally omitted
			});
			const token = buildConfirmToken({ sub: "sub_1", list: "newsletter" });
			const res = await server.handler(
				new Request(`http://localhost/emito/confirm?token=${token}`, { method: "POST" }),
			);
			expect(res.status).toBe(404);
		});
	});
});
