import type { ResolveSubscriberId } from "@emito/types";
import { verifyHS256 } from "./hs256.js";

export interface JwtAuthOptions {
	/** HMAC-SHA256 secret for JWT verification. Named `hmacSecret` (not `secret`) for future RS256 extension safety. */
	hmacSecret: string;
	/**
	 * Optional cookie name to fall back to when the `Authorization` header is
	 * absent. A browser's native `WebSocket` constructor can't attach an
	 * `Authorization` header to the handshake request, so `@emito/js`'s WS
	 * transport authenticates via cookie in that case instead (see its
	 * `isBrowser()`-gated auth strategy). Set this to the same cookie name your
	 * server sets — alongside the token handed to `EmitoProvider` — or the
	 * browser WS transport will authenticate over REST/SSE/polling but never
	 * over WS, with no error surfaced anywhere. Disabled (no cookie is read)
	 * unless set — the header-only default is unchanged for server/RN clients.
	 */
	cookieName?: string;
}

function extractCookie(cookieHeader: string, name: string): string | null {
	for (const part of cookieHeader.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		const key = part.slice(0, eq).trim();
		if (key !== name) continue;
		const value = part.slice(eq + 1).trim();
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}
	return null;
}

/**
 * Create a `resolveSubscriberId`-compatible function that authenticates
 * subscribers via HS256 JWT tokens.
 *
 * Extracts `Bearer <token>` from the `Authorization` header — falling back to
 * a named cookie when `cookieName` is configured and the header is absent —
 * verifies the HS256 signature and expiry, and returns the `subscriberId`
 * claim.
 *
 * Returns `null` on any failure — never throws.
 */
export function createJwtAuth(options: JwtAuthOptions): ResolveSubscriberId {
	const { hmacSecret, cookieName } = options;

	return async (req: Request): Promise<string | null> => {
		try {
			let token: string | null = null;

			const authorization = req.headers.get("authorization");
			if (authorization?.startsWith("Bearer ")) {
				const bearerToken = authorization.slice(7);
				if (bearerToken.length > 0) {
					token = bearerToken;
				}
			}

			if (token === null && cookieName) {
				const cookieHeader = req.headers.get("cookie");
				if (cookieHeader) {
					token = extractCookie(cookieHeader, cookieName);
				}
			}

			if (token === null || token.length === 0) {
				return null;
			}

			const result = verifyHS256(token, hmacSecret);
			if (result === null) {
				return null;
			}

			const { subscriberId } = result.payload;
			if (typeof subscriberId !== "string" || subscriberId.length === 0) {
				return null;
			}

			return subscriberId;
		} catch {
			return null;
		}
	};
}
