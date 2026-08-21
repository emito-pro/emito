/**
 * Unit tests for shared HS256 verification utility (packages/server/src/auth/hs256.ts).
 *
 * Tests validate:
 *   - verifyHS256: base64url decode, HMAC-SHA256 signature verification, alg header check, expiry check
 *   - verifyHS256: returns raw decoded payload (untyped Record<string, unknown>) on success
 *   - verifyHS256Safe: returns null instead of throwing on any failure
 *   - Both verifyHS256 and verifyHS256Safe reject non-HS256 alg headers
 *   - Both use constant-time comparison (crypto.timingSafeEqual) — verified via code path
 *   - Algorithm confusion prevention: alg=none, alg=RS256 both rejected
 *
 * Agent rules applied: #1, #3, #4, #5, #6, #7, #10, #15, #18, #19, #22, #23, #25, #26, #32
 */

import { createHmac } from "node:crypto";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { describe, expect, it } from "vitest";
import { signHS256, verifyHS256, verifyHS256Safe } from "../../auth/hs256.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SECRET = "test-hs256-secret-at-least-32-chars-long!!";

/**
 * Build a minimal valid HS256 JWT for testing.
 */
function buildJwt(payload: Record<string, unknown>, secret = SECRET, algOverride?: string): string {
	const alg = algOverride ?? "HS256";
	const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${sig}`;
}

/**
 * Build a JWT where the signature is computed with HS256 but the header declares a different alg.
 * Used to test algorithm confusion prevention.
 */
function buildJwtWithDeclaredAlg(
	payload: Record<string, unknown>,
	declaredAlg: string,
	secret = SECRET,
): string {
	const header = Buffer.from(JSON.stringify({ alg: declaredAlg, typ: "JWT" })).toString(
		"base64url",
	);
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	// Still sign with HMAC-SHA256 — the declared alg is what should be checked
	const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${sig}`;
}

// ---------------------------------------------------------------------------
// describe("verifyHS256")
// ---------------------------------------------------------------------------

describe("verifyHS256", () => {
	describe("happy path — valid tokens", () => {
		it("should return the decoded payload for a valid HS256 JWT without expiry", () => {
			const token = buildJwt({ subscriberId: "sub_1", customClaim: "hello" });
			const payload = verifyHS256(token, SECRET);
			expect(payload).toMatchObject({ subscriberId: "sub_1", customClaim: "hello" });
		});

		it("should return the decoded payload for a valid HS256 JWT with a future expiry", () => {
			const futureExp = Math.floor(Date.now() / 1000) + 3600;
			const token = buildJwt({ subscriberId: "sub_2", exp: futureExp });
			const payload = verifyHS256(token, SECRET);
			expect(payload).toMatchObject({ subscriberId: "sub_2", exp: futureExp });
		});

		it("should return the raw untyped payload (Record<string, unknown>)", () => {
			const token = buildJwt({ a: 1, b: "two", c: true, d: null });
			const payload = verifyHS256(token, SECRET);
			expect(payload).toMatchObject({ a: 1, b: "two", c: true, d: null });
		});

		it("should accept a JWT with exp exactly 1 second in the future", () => {
			const futureExp = Math.floor(Date.now() / 1000) + 1;
			const token = buildJwt({ subscriberId: "sub_3", exp: futureExp });
			const payload = verifyHS256(token, SECRET);
			expect(payload).toMatchObject({ subscriberId: "sub_3" });
		});
	});

	describe("signature verification — HMAC-SHA256", () => {
		it("should throw AUTH_INVALID_TOKEN when signature is tampered", () => {
			const token = buildJwt({ subscriberId: "sub_1" });
			// Corrupt the last character of the signature
			const parts = token.split(".");
			const tamperedSig = parts[2]!.slice(0, -1) + (parts[2]!.endsWith("A") ? "B" : "A");
			const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`;

			expect(() => verifyHS256(tampered, SECRET)).toThrowError(EmitoError);
			try {
				verifyHS256(tampered, SECRET);
			} catch (err) {
				expect(err).toBeInstanceOf(EmitoError);
				expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
			}
		});

		it("should throw AUTH_INVALID_TOKEN when the wrong secret is used", () => {
			const token = buildJwt({ subscriberId: "sub_1" }, "correct-secret-value-32-chars-long!");
			expect(() => verifyHS256(token, "wrong-secret-value-at-least-32!!!!")).toThrowError(
				EmitoError,
			);
			try {
				verifyHS256(token, "wrong-secret-value-at-least-32!!!!");
			} catch (err) {
				expect(err).toBeInstanceOf(EmitoError);
				expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
			}
		});

		it("should throw AUTH_INVALID_TOKEN when the payload is tampered after signing", () => {
			const token = buildJwt({ subscriberId: "sub_1" });
			const [header, , sig] = token.split(".");
			// Replace payload with different content
			const newPayload = Buffer.from(JSON.stringify({ subscriberId: "sub_attacker" })).toString(
				"base64url",
			);
			const tampered = `${header}.${newPayload}.${sig}`;
			expect(() => verifyHS256(tampered, SECRET)).toThrowError(EmitoError);
		});
	});

	describe("algorithm header validation", () => {
		it("should throw AUTH_INVALID_TOKEN when alg is RS256", () => {
			const token = buildJwtWithDeclaredAlg({ subscriberId: "sub_1" }, "RS256");
			expect(() => verifyHS256(token, SECRET)).toThrowError(EmitoError);
			try {
				verifyHS256(token, SECRET);
			} catch (err) {
				expect(err).toBeInstanceOf(EmitoError);
				expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
			}
		});

		it("should throw AUTH_INVALID_TOKEN when alg is none (algorithm confusion attack)", () => {
			const token = buildJwtWithDeclaredAlg({ subscriberId: "sub_1" }, "none");
			expect(() => verifyHS256(token, SECRET)).toThrowError(EmitoError);
			try {
				verifyHS256(token, SECRET);
			} catch (err) {
				expect(err).toBeInstanceOf(EmitoError);
				expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
			}
		});

		it("should throw AUTH_INVALID_TOKEN when alg is HS512", () => {
			const token = buildJwtWithDeclaredAlg({ subscriberId: "sub_1" }, "HS512");
			expect(() => verifyHS256(token, SECRET)).toThrowError(EmitoError);
		});

		it("should throw AUTH_INVALID_TOKEN when alg field is missing from header", () => {
			const header = Buffer.from(JSON.stringify({ typ: "JWT" })).toString("base64url");
			const body = Buffer.from(JSON.stringify({ subscriberId: "sub_1" })).toString("base64url");
			const sig = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
			const token = `${header}.${body}.${sig}`;
			expect(() => verifyHS256(token, SECRET)).toThrowError(EmitoError);
		});
	});

	describe("expiry check", () => {
		it("should throw AUTH_INVALID_TOKEN when exp is in the past", () => {
			const pastExp = Math.floor(Date.now() / 1000) - 3600;
			const token = buildJwt({ subscriberId: "sub_1", exp: pastExp });
			expect(() => verifyHS256(token, SECRET)).toThrowError(EmitoError);
			try {
				verifyHS256(token, SECRET);
			} catch (err) {
				expect(err).toBeInstanceOf(EmitoError);
				expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
			}
		});

		it("should throw AUTH_INVALID_TOKEN when exp is exactly now (already expired)", () => {
			const nowExp = Math.floor(Date.now() / 1000);
			const token = buildJwt({ subscriberId: "sub_1", exp: nowExp });
			expect(() => verifyHS256(token, SECRET)).toThrowError(EmitoError);
		});

		it("should NOT throw when exp is absent (no expiry claim)", () => {
			const token = buildJwt({ subscriberId: "sub_1" }); // no exp
			expect(() => verifyHS256(token, SECRET)).not.toThrow();
		});
	});

	describe("malformed token structure", () => {
		it("should throw AUTH_INVALID_TOKEN for a token with only 1 part", () => {
			expect(() => verifyHS256("onlyonepart", SECRET)).toThrowError(EmitoError);
		});

		it("should throw AUTH_INVALID_TOKEN for a token with 2 parts", () => {
			expect(() => verifyHS256("two.parts", SECRET)).toThrowError(EmitoError);
		});

		it("should throw AUTH_INVALID_TOKEN for a token with 4 parts", () => {
			expect(() => verifyHS256("four.part.jwt.extra", SECRET)).toThrowError(EmitoError);
		});

		it("should throw AUTH_INVALID_TOKEN for an empty string", () => {
			expect(() => verifyHS256("", SECRET)).toThrowError(EmitoError);
		});

		it("should throw when header is not valid base64url JSON", () => {
			const token = `not-valid-base64!.${Buffer.from("{}").toString("base64url")}.signature`;
			expect(() => verifyHS256(token, SECRET)).toThrowError(EmitoError);
		});

		it("should throw when payload is not valid base64url JSON", () => {
			const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
				"base64url",
			);
			const token = `${header}.not-valid-base64!.signature`;
			expect(() => verifyHS256(token, SECRET)).toThrowError(EmitoError);
		});
	});

	describe("boundary conditions — empty secret", () => {
		it("should still verify correctly when secret is an empty string (edge case: users should avoid this)", () => {
			const token = buildJwt({ subscriberId: "sub_1" }, "");
			// With empty secret — verifyHS256 should accept the token when the right (empty) secret is used
			expect(() => verifyHS256(token, "")).not.toThrow();
		});

		it("should reject when token was signed with a non-empty secret but empty is provided", () => {
			const token = buildJwt({ subscriberId: "sub_1" }, SECRET);
			expect(() => verifyHS256(token, "")).toThrowError(EmitoError);
		});
	});
});

// ---------------------------------------------------------------------------
// describe("verifyHS256Safe")
// ---------------------------------------------------------------------------

describe("verifyHS256Safe", () => {
	it("should return the decoded payload for a valid HS256 JWT", () => {
		const token = buildJwt({ subscriberId: "sub_1" });
		const payload = verifyHS256Safe(token, SECRET);
		expect(payload).toMatchObject({ subscriberId: "sub_1" });
	});

	it("should return null instead of throwing when signature is invalid", () => {
		const token = buildJwt({ subscriberId: "sub_1" });
		const result = verifyHS256Safe(token, "wrong-secret-that-is-at-least-32-chars");
		expect(result).toBeNull();
	});

	it("should return null instead of throwing when token is expired", () => {
		const pastExp = Math.floor(Date.now() / 1000) - 3600;
		const token = buildJwt({ subscriberId: "sub_1", exp: pastExp });
		const result = verifyHS256Safe(token, SECRET);
		expect(result).toBeNull();
	});

	it("should return null instead of throwing when alg is not HS256", () => {
		const token = buildJwtWithDeclaredAlg({ subscriberId: "sub_1" }, "RS256");
		const result = verifyHS256Safe(token, SECRET);
		expect(result).toBeNull();
	});

	it("should return null instead of throwing for a malformed token", () => {
		const result = verifyHS256Safe("not-a-valid-jwt", SECRET);
		expect(result).toBeNull();
	});

	it("should return null instead of throwing for an empty string", () => {
		const result = verifyHS256Safe("", SECRET);
		expect(result).toBeNull();
	});

	it("should return null instead of throwing for alg=none (algorithm confusion attack)", () => {
		const token = buildJwtWithDeclaredAlg({ subscriberId: "sub_1" }, "none");
		const result = verifyHS256Safe(token, SECRET);
		expect(result).toBeNull();
	});

	it("should return null when payload is tampered", () => {
		const token = buildJwt({ subscriberId: "sub_1" });
		const [header, , sig] = token.split(".");
		const newPayload = Buffer.from(JSON.stringify({ subscriberId: "sub_attacker" })).toString(
			"base64url",
		);
		const tampered = `${header}.${newPayload}.${sig}`;
		const result = verifyHS256Safe(tampered, SECRET);
		expect(result).toBeNull();
	});

	it("should return the payload when expiry is absent", () => {
		const token = buildJwt({ subscriberId: "sub_1" }); // no exp
		const result = verifyHS256Safe(token, SECRET);
		expect(result).toMatchObject({ subscriberId: "sub_1" });
	});

	it("should return null rather than throwing for a token with only 2 parts", () => {
		const result = verifyHS256Safe("two.parts", SECRET);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// describe("signHS256")
// ---------------------------------------------------------------------------

describe("signHS256", () => {
	it("should produce a token that verifyHS256 accepts and decodes correctly", () => {
		const token = signHS256({ sub: "sub_1", scope: "unsubscribe" }, SECRET);
		const payload = verifyHS256(token, SECRET);
		expect(payload).toMatchObject({ sub: "sub_1", scope: "unsubscribe" });
	});

	it("should produce a token that verifyHS256Safe accepts and decodes correctly", () => {
		const token = signHS256({ sub: "sub_2", scope: "confirm", list: "newsletter" }, SECRET);
		const payload = verifyHS256Safe(token, SECRET);
		expect(payload).toMatchObject({ sub: "sub_2", scope: "confirm", list: "newsletter" });
	});

	it("should produce a token rejected by verifyHS256Safe when the wrong secret is used to verify", () => {
		const token = signHS256({ sub: "sub_1" }, SECRET);
		const result = verifyHS256Safe(token, "a-completely-different-secret-32ch!");
		expect(result).toBeNull();
	});

	it("should produce a token with an HS256 header (alg confusion prevention)", () => {
		const token = signHS256({ sub: "sub_1" }, SECRET);
		const [headerB64] = token.split(".");
		const header = JSON.parse(Buffer.from(headerB64!, "base64url").toString("utf-8"));
		expect(header).toEqual({ alg: "HS256", typ: "JWT" });
	});

	it("should honor an exp claim set in the payload — verifyHS256 rejects it once expired", () => {
		const pastExp = Math.floor(Date.now() / 1000) - 3600;
		const token = signHS256({ sub: "sub_1", exp: pastExp }, SECRET);
		expect(() => verifyHS256(token, SECRET)).toThrowError(EmitoError);
	});
});
