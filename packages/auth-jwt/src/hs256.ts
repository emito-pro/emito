import { createHmac, timingSafeEqual } from "node:crypto";

export interface HS256Result {
	header: Record<string, unknown>;
	payload: Record<string, unknown>;
}

/**
 * Sign a JSON payload as a compact HS256 JWT (`header.payload.signature`).
 *
 * Produces a fixed `{ alg: "HS256", typ: "JWT" }` header and HMAC-SHA256 signs
 * `header.payload` with the supplied secret. Callers are responsible for placing
 * `iat`/`exp` (seconds since epoch) into `payload` — this helper does not inject
 * time claims so it stays deterministic and testable. The signature is base64url
 * encoded (no padding), matching what {@link verifyHS256} expects.
 *
 * Side effects: none. Never throws for well-formed JSON payloads.
 *
 * @param payload - The claims object to encode (must be JSON-serialisable).
 * @param secret - The HMAC-SHA256 secret shared with the verifier.
 * @returns The compact JWT string.
 */
export function signHS256(payload: Record<string, unknown>, secret: string): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${signature}`;
}

/**
 * Verify an HS256 JWT token and return the decoded header + payload.
 *
 * Returns null on any verification failure (never throws).
 *
 * Handles: base64url decode, header validation (alg must be HS256),
 * HMAC-SHA256 signature verification (timing-safe), and expiry check.
 */
export function verifyHS256(token: string, secret: string): HS256Result | null {
	const parts = token.split(".");
	if (parts.length !== 3) {
		return null;
	}

	const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

	// Decode and validate header — only HS256 allowed (algorithm confusion prevention)
	let header: Record<string, unknown>;
	try {
		header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8")) as Record<
			string,
			unknown
		>;
	} catch {
		return null;
	}

	if (header.alg !== "HS256") {
		return null;
	}

	// Verify HMAC-SHA256 signature (timing-safe comparison)
	const signatureInput = `${headerB64}.${payloadB64}`;
	const expectedSignature = createHmac("sha256", secret).update(signatureInput).digest();
	const actualSignature = Buffer.from(signatureB64, "base64url");

	if (
		expectedSignature.length !== actualSignature.length ||
		!timingSafeEqual(expectedSignature, actualSignature)
	) {
		return null;
	}

	// Decode payload
	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as Record<
			string,
			unknown
		>;
	} catch {
		return null;
	}

	// Check expiration
	if (typeof payload.exp === "number") {
		const now = Math.floor(Date.now() / 1000);
		if (now >= payload.exp) {
			return null;
		}
	}

	return { header, payload };
}
