import { createHmac, timingSafeEqual } from "node:crypto";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";

/**
 * Decoded HS256 JWT payload — untyped record.
 * Callers apply their own claim validation (Zod or manual) on top.
 */
export type HS256Payload = Record<string, unknown>;

/**
 * Verify an HS256-signed JWT token.
 *
 * Handles: base64url decode, HMAC-SHA256 signature verification (timing-safe),
 * header `alg` check (HS256 only), and optional expiry check.
 *
 * Returns the raw decoded payload on success.
 * Throws `EmitoError` with `AUTH_INVALID_TOKEN` on any failure.
 */
export function verifyHS256(token: string, secret: string): HS256Payload {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INVALID_TOKEN,
			message: "Malformed JWT: expected 3 parts",
		});
	}

	const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

	// Decode and validate header — only HS256 allowed
	let header: Record<string, unknown>;
	try {
		header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8")) as Record<
			string,
			unknown
		>;
	} catch {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INVALID_TOKEN,
			message: "Malformed JWT header",
		});
	}

	if (header.alg !== "HS256") {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INVALID_TOKEN,
			message: `Unsupported JWT algorithm: ${String(header.alg)}. Only HS256 is allowed.`,
		});
	}

	// Verify HMAC-SHA256 signature (timing-safe)
	const signatureInput = `${headerB64}.${payloadB64}`;
	const expectedSignature = createHmac("sha256", secret).update(signatureInput).digest();
	const actualSignature = Buffer.from(signatureB64, "base64url");

	if (
		expectedSignature.length !== actualSignature.length ||
		!timingSafeEqual(expectedSignature, actualSignature)
	) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INVALID_TOKEN,
			message: "Invalid JWT signature",
		});
	}

	// Decode payload
	let payload: HS256Payload;
	try {
		payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as HS256Payload;
	} catch {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INVALID_TOKEN,
			message: "Malformed JWT payload",
		});
	}

	// Check expiration if present
	if (typeof payload.exp === "number") {
		const now = Math.floor(Date.now() / 1000);
		if (now >= payload.exp) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.AUTH_INVALID_TOKEN,
				message: "JWT has expired",
			});
		}
	}

	return payload;
}

/**
 * Sign a payload as an HS256 JWT token.
 * Returns the compact `header.payload.signature` string.
 */
export function signHS256(payload: HS256Payload, secret: string): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${signature}`;
}

/**
 * Safe variant of `verifyHS256` — returns `null` instead of throwing.
 * Use for callers that handle failures by rendering a generic error page
 * or returning `false` (e.g., unsubscribe tokens, webhook verification).
 */
export function verifyHS256Safe(token: string, secret: string): HS256Payload | null {
	try {
		return verifyHS256(token, secret);
	} catch {
		return null;
	}
}
