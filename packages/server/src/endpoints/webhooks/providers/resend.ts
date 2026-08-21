import crypto from "node:crypto";
import type { DeliveryStatus } from "@emito/types";
import { z } from "zod";
import type { WebhookEvent, WebhookVerifier } from "../types.js";

const STATUS_MAP: Record<string, DeliveryStatus> = {
	"email.sent": "sent",
	"email.delivered": "delivered",
	"email.bounced": "bounced",
	"email.complained": "complained",
	"email.delivery_delayed": "deferred",
};

const REPLAY_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

const ResendEventSchema = z.object({
	type: z.string(),
	data: z.object({
		email_id: z.string(),
	}),
});

export const resendVerifier: WebhookVerifier = {
	verify(rawBody: string, headers: Headers, secret: string): boolean {
		const svixId = headers.get("svix-id");
		const svixTimestamp = headers.get("svix-timestamp");
		const svixSignature = headers.get("svix-signature");

		if (!svixId || !svixTimestamp || !svixSignature) return false;

		// Replay protection: reject timestamps older than 5 minutes
		const timestampSec = Number(svixTimestamp);
		if (Number.isNaN(timestampSec)) return false;
		const age = Math.abs(Date.now() - timestampSec * 1000);
		if (age > REPLAY_TOLERANCE_MS) return false;

		// Decode the whsec_ prefixed secret
		const secretBytes = Buffer.from(
			secret.startsWith("whsec_") ? secret.slice(6) : secret,
			"base64",
		);

		// Sign: {svix-id}.{svix-timestamp}.{rawBody}
		const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
		const expected = crypto.createHmac("sha256", secretBytes).update(toSign).digest("base64");

		// svix-signature may contain multiple signatures separated by spaces (v1,xxx format)
		const signatures = svixSignature.split(" ");
		for (const sig of signatures) {
			const parts = sig.split(",");
			const sigValue = parts[1];
			if (!sigValue) continue;
			try {
				const sigBuf = Buffer.from(sigValue, "base64");
				const expectedBuf = Buffer.from(expected, "base64");
				if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
					return true;
				}
			} catch {
				// Fail closed: any decode/compare error means this signature can't be
				// trusted, so treat it as invalid and keep checking the rest.
			}
		}
		return false;
	},

	normalize(payload: unknown): WebhookEvent[] {
		const parsed = ResendEventSchema.safeParse(payload);
		if (!parsed.success) return [];

		const { type, data } = parsed.data;
		const status = STATUS_MAP[type];
		if (!status) return [];

		return [{ providerMsgId: data.email_id, status, metadata: { type } }];
	},
};
