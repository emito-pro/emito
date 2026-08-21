/**
 * Security tests for @emito/auth-jwt.
 *
 * Covers: algorithm confusion prevention, timing-safe comparison, self-containment,
 * and attack surface beyond the unit tests.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHS256 } from "../../src/hs256.js";
import { createJwtAuth } from "../../src/jwt-auth.js";

const TEST_SECRET = "test-secret-that-is-long-enough-for-hmac";

function base64url(data: string): string {
	return Buffer.from(data, "utf-8").toString("base64url");
}

function signToken(
	payload: Record<string, unknown>,
	secret: string = TEST_SECRET,
	alg = "HS256",
): string {
	const header = base64url(JSON.stringify({ alg, typ: "JWT" }));
	const body = base64url(JSON.stringify(payload));
	const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${signature}`;
}

function makeRequest(authorization?: string): Request {
	const headers = new Headers();
	if (authorization !== undefined) {
		headers.set("authorization", authorization);
	}
	return new Request("http://localhost/test", { headers });
}

describe("createJwtAuth — security", () => {
	const auth = createJwtAuth({ hmacSecret: TEST_SECRET });

	describe("algorithm confusion prevention", () => {
		it("rejects token with alg: none", async () => {
			const header = base64url(JSON.stringify({ alg: "none", typ: "JWT" }));
			const body = base64url(
				JSON.stringify({ subscriberId: "attacker", exp: Math.floor(Date.now() / 1000) + 3600 }),
			);
			const token = `${header}.${body}.`;
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});

		it("rejects token with alg: RS256", async () => {
			const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
			const body = base64url(
				JSON.stringify({ subscriberId: "attacker", exp: Math.floor(Date.now() / 1000) + 3600 }),
			);
			const signature = createHmac("sha256", TEST_SECRET)
				.update(`${header}.${body}`)
				.digest("base64url");
			const token = `${header}.${body}.${signature}`;
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});

		it("rejects token with alg: HS512", async () => {
			const header = base64url(JSON.stringify({ alg: "HS512", typ: "JWT" }));
			const body = base64url(
				JSON.stringify({ subscriberId: "sub_123", exp: Math.floor(Date.now() / 1000) + 3600 }),
			);
			const signature = createHmac("sha256", TEST_SECRET)
				.update(`${header}.${body}`)
				.digest("base64url");
			const token = `${header}.${body}.${signature}`;
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});

		it("rejects token where alg field is missing from header", async () => {
			const header = base64url(JSON.stringify({ typ: "JWT" }));
			const body = base64url(
				JSON.stringify({ subscriberId: "sub_123", exp: Math.floor(Date.now() / 1000) + 3600 }),
			);
			const signature = createHmac("sha256", TEST_SECRET)
				.update(`${header}.${body}`)
				.digest("base64url");
			const token = `${header}.${body}.${signature}`;
			const result = await auth(makeRequest(`Bearer ${token}`));
			expect(result).toBeNull();
		});
	});

	describe("signature tampering", () => {
		it("rejects a token with payload tampered after signing", async () => {
			const originalPayload = {
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			};
			const token = signToken(originalPayload);
			const [headerB64, , signatureB64] = token.split(".");
			const tamperedPayload = base64url(
				JSON.stringify({ subscriberId: "attacker", exp: Math.floor(Date.now() / 1000) + 3600 }),
			);
			const tamperedToken = `${headerB64}.${tamperedPayload}.${signatureB64}`;
			const result = await auth(makeRequest(`Bearer ${tamperedToken}`));
			expect(result).toBeNull();
		});

		it("rejects a token with header tampered after signing", async () => {
			const token = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const [, payloadB64, signatureB64] = token.split(".");
			const tamperedHeader = base64url(
				JSON.stringify({ alg: "HS256", typ: "JWT", kid: "injected" }),
			);
			const tamperedToken = `${tamperedHeader}.${payloadB64}.${signatureB64}`;
			const result = await auth(makeRequest(`Bearer ${tamperedToken}`));
			expect(result).toBeNull();
		});

		it("rejects a token with one signature byte flipped", async () => {
			const token = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const parts = token.split(".");
			const sigBuf = Buffer.from(parts[2] as string, "base64url");
			const firstByte = sigBuf[0];
			if (firstByte === undefined) throw new Error("signature buffer is empty");
			sigBuf[0] = firstByte ^ 0xff;
			const flippedToken = `${parts[0]}.${parts[1]}.${sigBuf.toString("base64url")}`;
			const result = await auth(makeRequest(`Bearer ${flippedToken}`));
			expect(result).toBeNull();
		});
	});

	describe("timing-safe comparison (verifyHS256 unit)", () => {
		it("rejects same-length but wrong signature", () => {
			const validToken = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const parts = validToken.split(".");
			const correctSig = Buffer.from(parts[2] as string, "base64url");
			const wrongSig = Buffer.alloc(correctSig.length, 0xff);
			const samelenToken = `${parts[0]}.${parts[1]}.${wrongSig.toString("base64url")}`;
			const result = verifyHS256(samelenToken, TEST_SECRET);
			expect(result).toBeNull();
		});

		it("rejects token where signature has different length", () => {
			const [headerB64, payloadB64] = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			}).split(".");
			const shortSigToken = `${headerB64}.${payloadB64}.YQ`;
			const result = verifyHS256(shortSigToken, TEST_SECRET);
			expect(result).toBeNull();
		});
	});

	describe("self-containment", () => {
		it("package.json has no dependency on @emito/server", async () => {
			const { readFileSync } = await import("node:fs");
			const pkgJson = JSON.parse(
				readFileSync(new URL("../../package.json", import.meta.url).pathname, "utf-8"),
			) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

			const deps = pkgJson.dependencies ?? {};
			const devDeps = pkgJson.devDependencies ?? {};

			expect(deps["@emito/server"]).toBeUndefined();
			expect(devDeps["@emito/server"]).toBeUndefined();
		});

		it("depends only on @emito/types and Node.js built-ins", async () => {
			const { readFileSync } = await import("node:fs");
			const pkgJson = JSON.parse(
				readFileSync(new URL("../../package.json", import.meta.url).pathname, "utf-8"),
			) as { dependencies?: Record<string, string> };

			const deps = Object.keys(pkgJson.dependencies ?? {});
			expect(deps).toEqual(["@emito/types"]);
		});
	});

	describe("public API surface", () => {
		it("createJwtAuth accepts hmacSecret field name (not secret)", () => {
			const fn = createJwtAuth({ hmacSecret: TEST_SECRET });
			expect(typeof fn).toBe("function");
		});

		it("re-exports createJwtAuth from package index", async () => {
			const mod = await import("../../src/index.js");
			expect(typeof mod.createJwtAuth).toBe("function");
		});
	});

	describe("edge cases from Authorization header", () => {
		it("returns null when Authorization header is an empty string", async () => {
			const result = await auth(makeRequest(""));
			expect(result).toBeNull();
		});

		it("returns null when Authorization is 'Bearer' with no space or token", async () => {
			const result = await auth(makeRequest("Bearer"));
			expect(result).toBeNull();
		});

		it("returns null when token has extra dots (4-part JWT)", async () => {
			const token = signToken({
				subscriberId: "sub_123",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const result = await auth(makeRequest(`Bearer ${token}.extra`));
			expect(result).toBeNull();
		});

		it("returns null when token is all dots", async () => {
			const result = await auth(makeRequest("Bearer ..."));
			expect(result).toBeNull();
		});

		it("returns null for non-base64 token", async () => {
			const result = await auth(makeRequest("Bearer this is not a jwt at all"));
			expect(result).toBeNull();
		});
	});
});
