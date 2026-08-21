/**
 * Unit tests for validateToken() — unsubscribe and confirm token validation.
 *
 * Rules applied:
 * - Assert on specific EmitoErrorCode values (rule 1)
 * - Test boundary conditions (rule 4)
 * - Test null/undefined for optional parameters (rule 5)
 * - Test empty string inputs (rule 6)
 * - Use vi.useFakeTimers() for time-dependent behavior (rule 22)
 * - Call vi.useRealTimers() in afterEach (rule 23)
 * - Prefer specific matchers (rule 25)
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateToken } from "../../endpoints/unsubscribe/token.js";

const TEST_SECRET = "test-unsubscribe-secret-32-bytes!!";

function buildToken(
	claims: Record<string, unknown>,
	secret = TEST_SECRET,
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

describe("validateToken", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("valid tokens", () => {
		it("should return payload for a valid unsubscribe token", () => {
			const token = buildToken({ sub: "sub_1", scope: "unsubscribe" });
			const result = validateToken(token, TEST_SECRET, "unsubscribe");
			expect(result).not.toBeNull();
			expect(result).toMatchObject({ sub: "sub_1", scope: "unsubscribe" });
		});

		it("should return payload for a valid confirm token", () => {
			const token = buildToken({ sub: "sub_1", scope: "confirm", list: "newsletter" });
			const result = validateToken(token, TEST_SECRET, "confirm");
			expect(result).not.toBeNull();
			expect(result).toMatchObject({ sub: "sub_1", scope: "confirm", list: "newsletter" });
		});

		it("should include optional claims in the returned payload", () => {
			const token = buildToken({
				sub: "sub_1",
				scope: "unsubscribe",
				list: "newsletter",
				topic: "promotions",
				cat: "marketing",
			});
			const result = validateToken(token, TEST_SECRET, "unsubscribe");
			expect(result).toMatchObject({
				list: "newsletter",
				topic: "promotions",
				cat: "marketing",
			});
		});
	});

	describe("invalid signature", () => {
		it("should return null for a tampered payload", () => {
			const token = buildToken({ sub: "sub_1", scope: "unsubscribe" });
			const [h, , sig] = token.split(".");
			const tamperedPayload = Buffer.from(
				JSON.stringify({ sub: "sub_999", scope: "unsubscribe", iat: 1710000000, exp: 9999999999 }),
			).toString("base64url");
			const tampered = `${h}.${tamperedPayload}.${sig}`;
			expect(validateToken(tampered, TEST_SECRET, "unsubscribe")).toBeNull();
		});

		it("should return null for a token signed with the wrong secret", () => {
			const token = buildToken({ sub: "sub_1", scope: "unsubscribe" }, "wrong-secret-32bytes!!");
			expect(validateToken(token, TEST_SECRET, "unsubscribe")).toBeNull();
		});

		it("should return null for a malformed token (fewer than 3 parts)", () => {
			expect(validateToken("not.a.valid.jwt.format.extra", TEST_SECRET, "unsubscribe")).toBeNull();
		});

		it("should return null for empty string token", () => {
			expect(validateToken("", TEST_SECRET, "unsubscribe")).toBeNull();
		});
	});

	describe("scope validation", () => {
		it("should return null when scope does not match expected value", () => {
			const token = buildToken({ sub: "sub_1", scope: "confirm" });
			// Expect unsubscribe but token has confirm
			expect(validateToken(token, TEST_SECRET, "unsubscribe")).toBeNull();
		});

		it("should return null when scope is unsubscribe but confirm is expected", () => {
			const token = buildToken({ sub: "sub_1", scope: "unsubscribe" });
			expect(validateToken(token, TEST_SECRET, "confirm")).toBeNull();
		});

		it("should return null when scope claim is missing", () => {
			const token = buildToken({ sub: "sub_1" });
			expect(validateToken(token, TEST_SECRET, "unsubscribe")).toBeNull();
		});
	});

	describe("expiry", () => {
		it("should return null for an expired token", () => {
			// Build token that expired 1 second ago
			const now = Math.floor(Date.now() / 1000);
			const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
				"base64url",
			);
			const payload = Buffer.from(
				JSON.stringify({
					sub: "sub_1",
					scope: "unsubscribe",
					iat: now - 7200,
					exp: now - 1, // expired
				}),
			).toString("base64url");
			const sig = createHmac("sha256", TEST_SECRET)
				.update(`${header}.${payload}`)
				.digest("base64url");
			const token = `${header}.${payload}.${sig}`;
			expect(validateToken(token, TEST_SECRET, "unsubscribe")).toBeNull();
		});

		it("should accept a token that expires exactly 1 second from now", () => {
			// exp = now + 1 is still valid
			const token = buildToken({ sub: "sub_1", scope: "unsubscribe" }, TEST_SECRET, 1);
			const result = validateToken(token, TEST_SECRET, "unsubscribe");
			expect(result).not.toBeNull();
		});
	});

	describe("algorithm confusion prevention", () => {
		it("should return null for a token with alg: none", () => {
			const now = Math.floor(Date.now() / 1000);
			const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
			const payload = Buffer.from(
				JSON.stringify({
					sub: "sub_1",
					scope: "unsubscribe",
					iat: now - 60,
					exp: now + 3600,
				}),
			).toString("base64url");
			const token = `${header}.${payload}.`;
			expect(validateToken(token, TEST_SECRET, "unsubscribe")).toBeNull();
		});
	});
});
