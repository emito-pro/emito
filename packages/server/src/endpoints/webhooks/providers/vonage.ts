import crypto from "node:crypto";
import type { DeliveryStatus } from "@emito/types";
import { z } from "zod";
import { verifyHS256Safe } from "../../../auth/hs256.js";
import type { WebhookEvent, WebhookVerifier } from "../types.js";

const STATUS_MAP: Record<string, DeliveryStatus> = {
	delivered: "delivered",
	rejected: "failed",
	failed: "failed",
};

const VonageJwtPayloadSchema = z.object({
	iat: z.number().optional(),
	payload_hash: z.string(),
});

const VonageEventSchema = z.object({
	status: z.string(),
	message_uuid: z.string(),
});

export const vonageVerifier: WebhookVerifier = {
	verify(rawBody: string, headers: Headers, secret: string): boolean {
		const authHeader = headers.get("authorization");
		if (!authHeader?.startsWith("Bearer ")) return false;

		const token = authHeader.slice(7);

		try {
			// Shared HS256 verification: signature, alg check, expiry
			const rawPayload = verifyHS256Safe(token, secret);
			if (!rawPayload) return false;

			const jwtResult = VonageJwtPayloadSchema.safeParse(rawPayload);
			if (!jwtResult.success) return false;

			const { iat, payload_hash: payloadHash } = jwtResult.data;

			// Vonage-specific claim validation: iat age check
			if (iat !== undefined) {
				const age = Math.abs(Date.now() / 1000 - iat);
				if (age > 5 * 60 + 30) return false; // 5 min + 30s tolerance
			}

			// Verify payload_hash claim against SHA-256 of raw body
			const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");

			const hashBuf = Buffer.from(payloadHash, "hex");
			const bodyHashBuf = Buffer.from(bodyHash, "hex");
			if (hashBuf.length !== bodyHashBuf.length) return false;
			return crypto.timingSafeEqual(hashBuf, bodyHashBuf);
		} catch {
			return false;
		}
	},

	normalize(payload: unknown): WebhookEvent[] {
		const parsed = VonageEventSchema.safeParse(payload);
		if (!parsed.success) return [];

		const { status: messageStatus, message_uuid: providerMsgId } = parsed.data;

		const status = STATUS_MAP[messageStatus];
		if (!status) return [];

		return [{ providerMsgId, status, metadata: { messageStatus } }];
	},
};
