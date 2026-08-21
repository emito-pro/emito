import { z } from "zod";
import { verifyHS256Safe } from "../../auth/hs256.js";

const TokenPayloadSchema = z.object({
	sub: z.string().min(1),
	scope: z.string(),
	list: z.string().optional(),
	topic: z.string().optional(),
	cat: z.string().optional(),
	iat: z.number(),
	exp: z.number(),
});

export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

/**
 * Validate an HMAC-SHA256 JWT token for unsubscribe/confirm flows.
 * Returns the typed payload on success, or null on any failure
 * (invalid signature, expired, wrong scope).
 *
 * Does NOT throw — callers render a generic "link expired" page on null.
 */
export function validateToken(
	token: string,
	secret: string,
	expectedScope: string,
): TokenPayload | null {
	// Shared HS256 verification: signature, alg check, expiry
	const raw = verifyHS256Safe(token, secret);
	if (!raw) return null;

	// Claim validation specific to unsubscribe/confirm tokens
	const parsed = TokenPayloadSchema.safeParse(raw);
	if (!parsed.success) return null;

	const payload = parsed.data;

	// Validate scope
	if (payload.scope !== expectedScope) return null;

	return payload;
}
