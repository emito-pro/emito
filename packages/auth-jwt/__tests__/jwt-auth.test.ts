/**
 * Unit tests for createJwtAuth (@emito/auth-jwt).
 *
 * Tests validate the plan's success criteria (005f task 2):
 *   - createJwtAuth({ hmacSecret }) returns a ResolveSubscriberId-compatible function
 *   - Receives Web Standard Request, extracts Bearer token via req.headers.get('authorization')
 *   - Verifies HS256 signature, expiry, and subscriberId claim
 *   - Returns subscriberId on success, null on any failure (never throws)
 *
 * Agent rules applied: #6, #10, #15, #22, #23, #25, #26, #32
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createJwtAuth } from "../src/jwt-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-secret-that-is-long-enough-for-hmac";

function base64url(data: string): string {
	return Buffer.from(data, "utf-8").toString("base64url");
}

function signToken(payload: Record<string, unknown>, secret: string = TEST_SECRET): string {
	const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = base64url(JSON.stringify(payload));
	const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${signature}`;
}

/**
 * Build a Web Standard Request with an optional Authorization header.
 * The auth middleware extracts the token via `req.headers.get('authorization')`.
 */
function makeRequest(authorization?: string): Request {
	const headers: Record<string, string> = {};
	if (authorization !== undefined) {
		headers["authorization"] = authorization;
	}
	return new Request("http://localhost/", { headers });
}

/** Build a Web Standard Request with an optional Cookie header, no Authorization. */
function makeCookieRequest(cookieHeader?: string): Request {
	const headers: Record<string, string> = {};
	if (cookieHeader !== undefined) {
		headers["cookie"] = cookieHeader;
	}
	return new Request("http://localhost/", { headers });
}

// ---------------------------------------------------------------------------
// describe("createJwtAuth")
// ---------------------------------------------------------------------------

describe("createJwtAuth", () => {
	const auth = createJwtAuth({ hmacSecret: TEST_SECRET });

	describe("valid tokens — happy path", () => {
		it("should return subscriberId for a valid HS256 token with future expiry", async () => {
			const token = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBe("sub_123");
		});

		it("should return subscriberId when exp claim is absent (no expiry enforcement)", async () => {
			const token = signToken({ subscriberId: "sub_no_exp" });
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBe("sub_no_exp");
		});

		it("should return subscriberId extracted from a token with additional custom claims", async () => {
			const token = signToken({
				subscriberId: "sub_456",
				exp: Math.floor(Date.now() / 1000) + 7200,
				role: "user",
				tenantId: "tenant_1",
			});
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBe("sub_456");
		});
	});

	describe("expired token", () => {
		it("should return null for an expired token (exp in the past)", async () => {
			const token = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) - 60,
			});
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});

		it("should return null when exp is exactly now (boundary: already expired)", async () => {
			const token = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000),
			});
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});
	});

	describe("invalid signature", () => {
		it("should return null when token is signed with a different secret", async () => {
			const token = signToken(
				{
					subscriberId: "sub_123",
					exp: Math.floor(Date.now() / 1000) + 3600,
				},
				"wrong-secret-value-that-differs-from-test",
			);
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});

		it("should return null when the payload is tampered after signing", async () => {
			const token = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const [header, , sig] = token.split(".");
			const tamperedPayload = base64url(
				JSON.stringify({ subscriberId: "sub_attacker", exp: Math.floor(Date.now() / 1000) + 3600 }),
			);
			const tampered = `${header}.${tamperedPayload}.${sig}`;
			const result = await auth(makeRequest(`Bearer ${tampered}`));
			expect(result).toBeNull();
		});
	});

	describe("missing subscriberId claim", () => {
		it("should return null when subscriberId claim is absent (uses sub instead)", async () => {
			const token = signToken({
				sub: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});

		it("should return null when subscriberId is not a string (numeric)", async () => {
			const token = signToken({
				subscriberId: 123,
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});

		it("should return null when subscriberId is an empty string", async () => {
			const token = signToken({
				subscriberId: "",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});

		it("should return null when subscriberId is null", async () => {
			const token = signToken({
				subscriberId: null,
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});
	});

	describe("missing Authorization header", () => {
		it("should return null when Authorization header is absent", async () => {
			const result = await auth(makeRequest());
			expect(result).toBeNull();
		});

		it("should return null when Authorization header is an empty string", async () => {
			const result = await auth(makeRequest(""));
			expect(result).toBeNull();
		});
	});

	describe("malformed Bearer token", () => {
		it("should return null when Authorization has no Bearer prefix (Basic scheme)", async () => {
			const result = await auth(makeRequest("Basic dXNlcjpwYXNz"));
			expect(result).toBeNull();
		});

		it("should return null when Authorization is 'Bearer' without a token (no space)", async () => {
			const result = await auth(makeRequest("Bearer"));
			expect(result).toBeNull();
		});

		it("should return null when Authorization is 'Bearer ' with only whitespace after", async () => {
			const result = await auth(makeRequest("Bearer "));
			expect(result).toBeNull();
		});

		it("should return null for a completely malformed token after Bearer", async () => {
			const result = await auth(makeRequest("Bearer not-a-jwt"));
			expect(result).toBeNull();
		});

		it("should return null when bearer token has wrong number of parts", async () => {
			const result = await auth(makeRequest("Bearer two.parts"));
			expect(result).toBeNull();
		});

		it("should return null when bearer token has extra dots (4-part JWT)", async () => {
			const validToken = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const result = await auth(makeRequest(`Bearer ${validToken}.extra`));
			expect(result).toBeNull();
		});

		it("should return null when bearer token is all dots", async () => {
			const result = await auth(makeRequest("Bearer ..."));
			expect(result).toBeNull();
		});
	});

	describe("never throws", () => {
		it("should never throw for any garbage input — always returns null", async () => {
			const inputs = [
				"Bearer ",
				"Bearer ...",
				"Bearer abc.def.ghi",
				"",
				"Bearer !!!",
				"Bearer eyJhbGciOiJub25lIn0.",
				"Bearer " + "x".repeat(10000),
			];
			for (const input of inputs) {
				const result = await auth(makeRequest(input));
				expect(result).toBeNull();
			}
		});
	});

	describe("cookie fallback (disabled by default)", () => {
		it("should return null for a valid token in a cookie when cookieName is not configured", async () => {
			const token = signToken({
				subscriberId: "sub_cookie",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			// Same `auth` instance as the rest of this suite — created without `cookieName`.
			const result = await auth(makeCookieRequest(`emito_token=${token}`));
			expect(result).toBeNull();
		});
	});

	describe("cookie fallback (cookieName configured)", () => {
		const cookieAuth = createJwtAuth({ hmacSecret: TEST_SECRET, cookieName: "emito_token" });

		it("should return subscriberId from a cookie when Authorization is absent", async () => {
			const token = signToken({
				subscriberId: "sub_cookie",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const result = await cookieAuth(makeCookieRequest(`emito_token=${token}`));
			expect(result).toBe("sub_cookie");
		});

		it("should find the right cookie among several", async () => {
			const token = signToken({
				subscriberId: "sub_multi",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const result = await cookieAuth(
				makeCookieRequest(`other=1; emito_token=${token}; another=2`),
			);
			expect(result).toBe("sub_multi");
		});

		it("should prefer the Authorization header over the cookie when both are present", async () => {
			const headerToken = signToken({
				subscriberId: "sub_header",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const cookieToken = signToken({
				subscriberId: "sub_cookie",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const req = new Request("http://localhost/", {
				headers: {
					authorization: `Bearer ${headerToken}`,
					cookie: `emito_token=${cookieToken}`,
				},
			});
			const result = await cookieAuth(req);
			expect(result).toBe("sub_header");
		});

		it("should return null when neither Authorization nor the named cookie is present", async () => {
			const result = await cookieAuth(makeRequest());
			expect(result).toBeNull();
		});

		it("should return null when the cookie header has no matching cookie name", async () => {
			const result = await cookieAuth(makeCookieRequest("session=abc; other=1"));
			expect(result).toBeNull();
		});

		it("should return null for an expired token found in the cookie", async () => {
			const token = signToken({
				subscriberId: "sub_cookie",
				exp: Math.floor(Date.now() / 1000) - 60,
			});
			const result = await cookieAuth(makeCookieRequest(`emito_token=${token}`));
			expect(result).toBeNull();
		});

		it("never throws for a malformed cookie header", async () => {
			const result = await cookieAuth(makeCookieRequest("this is not; a=valid=cookie=header;;;"));
			expect(result).toBeNull();
		});

		it("falls back to the raw cookie value when it isn't valid percent-encoding", async () => {
			// "%" not followed by two hex digits makes decodeURIComponent throw.
			const result = await cookieAuth(makeCookieRequest("emito_token=not%valid%encoding"));
			// Falls through to raw value, which then fails HS256 verification (not a JWT) — still null,
			// but via the extractCookie catch branch rather than crashing.
			expect(result).toBeNull();
		});
	});

	describe("Web Standard Request header access", () => {
		it("should extract the Authorization header via headers.get() — not via property access", async () => {
			// Web Standard Request.headers is a Headers object with .get() method, NOT a plain object.
			// The implementation must use req.headers.get('authorization'), not req.headers.authorization.
			const token = signToken({
				subscriberId: "sub_web_std",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const req = new Request("http://localhost/", {
				headers: { Authorization: `Bearer ${token}` },
			});

			// Confirm: Web Standard Headers object does not expose headers as plain properties
			expect((req.headers as unknown as Record<string, string>)["authorization"]).toBeUndefined();
			// Confirm: .get() is the correct access method
			expect(req.headers.get("authorization")).toBe(`Bearer ${token}`);

			// The function must work correctly with Web Standard Request
			const result = await auth(req);
			expect(result).toBe("sub_web_std");
		});
	});
});
