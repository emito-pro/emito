import { createHmac } from "node:crypto";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { describe, expect, it, vi } from "vitest";
import { validateApiKey } from "../auth/api-key.js";
import { verifyHS256 } from "../auth/hs256.js";
import { enforceWorkspaceRole } from "../auth/workspace-role.js";

function createTestJwt(payload: Record<string, unknown>, secret: string, alg = "HS256"): string {
	const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${signature}`;
}

describe("verifyHS256", () => {
	const secret = "test-secret-key-at-least-32-chars-long";

	it("validates a correctly signed JWT", () => {
		const token = createTestJwt({ subscriberId: "sub_123" }, secret);
		const payload = verifyHS256(token, secret);
		expect(payload).toMatchObject({ subscriberId: "sub_123" });
	});

	it("rejects a JWT with wrong secret", () => {
		const token = createTestJwt({ subscriberId: "sub_123" }, "wrong-secret-key-at-least-32-chars");
		try {
			verifyHS256(token, secret);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
		}
	});

	it("rejects a malformed JWT", () => {
		expect(() => verifyHS256("not.a.valid.jwt.token", secret)).toThrow(EmitoError);
		expect(() => verifyHS256("just-a-string", secret)).toThrow(EmitoError);
	});

	it("rejects an expired JWT", () => {
		const pastExp = Math.floor(Date.now() / 1000) - 3600;
		const token = createTestJwt({ subscriberId: "sub_123", exp: pastExp }, secret);
		try {
			verifyHS256(token, secret);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
		}
	});

	it("accepts a non-expired JWT", () => {
		const futureExp = Math.floor(Date.now() / 1000) + 3600;
		const token = createTestJwt({ subscriberId: "sub_123", exp: futureExp }, secret);
		const payload = verifyHS256(token, secret);
		expect(payload).toMatchObject({ subscriberId: "sub_123" });
	});

	it("rejects JWT with non-HS256 algorithm header", () => {
		const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
		const body = Buffer.from(JSON.stringify({ subscriberId: "sub_123" })).toString("base64url");
		const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
		const token = `${header}.${body}.${signature}`;

		try {
			verifyHS256(token, secret);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
		}
	});

	it("returns payload without requiring subscriberId (verifyHS256 is a generic utility)", () => {
		// verifyHS256 does NOT require subscriberId — callers do their own claim validation
		const token = createTestJwt({ someOtherClaim: "value_123" }, secret);
		const payload = verifyHS256(token, secret);
		expect(payload).toMatchObject({ someOtherClaim: "value_123" });
	});
});

describe("validateApiKey", () => {
	it("accepts matching API key", () => {
		expect(() => validateApiKey("my-secret-key", "my-secret-key")).not.toThrow();
	});

	it("rejects mismatched API key", () => {
		try {
			validateApiKey("wrong-key", "correct-key");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_API_KEY);
		}
	});

	it("rejects different-length API key", () => {
		expect(() => validateApiKey("short", "much-longer-key")).toThrow(EmitoError);
	});
});

describe("enforceWorkspaceRole", () => {
	it("allows read access for member role", async () => {
		const resolve = vi.fn().mockResolvedValue("member");
		const role = await enforceWorkspaceRole(resolve, "sub_1", "ws_1", "GET");
		expect(role).toBe("member");
	});

	it("allows write access for admin role", async () => {
		const resolve = vi.fn().mockResolvedValue("admin");
		const role = await enforceWorkspaceRole(resolve, "sub_1", "ws_1", "POST");
		expect(role).toBe("admin");
	});

	it("denies write access for member role", async () => {
		const resolve = vi.fn().mockResolvedValue("member");
		try {
			await enforceWorkspaceRole(resolve, "sub_1", "ws_1", "PUT");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
		}
	});

	it("denies access for non-member (null)", async () => {
		const resolve = vi.fn().mockResolvedValue(null);
		await expect(enforceWorkspaceRole(resolve, "sub_1", "ws_1", "GET")).rejects.toThrow(EmitoError);
	});
});
