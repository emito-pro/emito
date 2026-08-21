/**
 * Unit tests for the HS256 sign/verify primitives (@emito/auth-jwt).
 *
 * `signHS256` is the counterpart to `verifyHS256` used by downstream packages
 * (e.g. admin session tokens). These tests assert the compact
 * JWT shape, the fixed HS256 header, a clean round-trip, and that verification
 * rejects tampering, a wrong secret, and expiry.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signHS256, verifyHS256 } from "../src/hs256.js";

const SECRET = "hs256-test-secret-long-enough";

describe("signHS256", () => {
	it("produces a compact 3-part JWT with an HS256 header", () => {
		const token = signHS256({ sub: "u1" }, SECRET);
		const parts = token.split(".");
		expect(parts).toHaveLength(3);
		const header = JSON.parse(Buffer.from(parts[0] as string, "base64url").toString("utf-8"));
		expect(header).toEqual({ alg: "HS256", typ: "JWT" });
	});

	it("round-trips through verifyHS256", () => {
		const now = Math.floor(Date.now() / 1000);
		const token = signHS256({ sub: "u1", role: "admin", exp: now + 100 }, SECRET);
		const decoded = verifyHS256(token, SECRET);
		expect(decoded).not.toBeNull();
		expect(decoded?.payload).toMatchObject({ sub: "u1", role: "admin" });
	});

	it("yields a signature that fails under a different secret", () => {
		const token = signHS256({ sub: "u1" }, SECRET);
		expect(verifyHS256(token, "another-secret")).toBeNull();
	});
});

describe("verifyHS256", () => {
	it("returns null for a tampered payload", () => {
		const token = signHS256({ sub: "u1" }, SECRET);
		const [h, , s] = token.split(".");
		const forgedPayload = Buffer.from(JSON.stringify({ sub: "attacker" })).toString("base64url");
		expect(verifyHS256(`${h}.${forgedPayload}.${s}`, SECRET)).toBeNull();
	});

	it("returns null for an expired token", () => {
		const now = Math.floor(Date.now() / 1000);
		const token = signHS256({ sub: "u1", exp: now - 1 }, SECRET);
		expect(verifyHS256(token, SECRET)).toBeNull();
	});

	it("returns null for a non-HS256 algorithm header", () => {
		const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
		const payload = Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url");
		const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
		expect(verifyHS256(`${header}.${payload}.${sig}`, SECRET)).toBeNull();
	});

	it("returns null for a malformed token", () => {
		expect(verifyHS256("only.two", SECRET)).toBeNull();
		expect(verifyHS256("###.###.###", SECRET)).toBeNull();
	});
});
