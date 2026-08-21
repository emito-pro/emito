import crypto from "node:crypto";
import type { DeliveryStatus } from "@emito/types";
import { z } from "zod";
import type { WebhookEvent, WebhookVerifier } from "../types.js";

const STATUS_MAP: Record<string, DeliveryStatus> = {
	sent: "sent",
	delivered: "delivered",
	undelivered: "bounced",
	failed: "failed",
};

const TwilioEventSchema = z
	.object({
		MessageStatus: z.string().optional(),
		SmsStatus: z.string().optional(),
		MessageSid: z.string(),
	})
	.refine((d) => d.MessageStatus !== undefined || d.SmsStatus !== undefined);

export const twilioVerifier: WebhookVerifier = {
	verify(rawBody: string, headers: Headers, authToken: string): boolean {
		const signature = headers.get("x-twilio-signature");
		if (!signature) return false;

		// Twilio HMAC-SHA1: sign URL + sorted form params
		// For webhook processing, the URL is passed via x-forwarded-url or reconstructed.
		// The rawBody contains URL-encoded form params.
		// Twilio signs: URL string + all POST param values in alphabetical key order
		const url = headers.get("x-forwarded-url") ?? headers.get("x-original-url") ?? "";

		// Parse form-encoded body and sort by key
		const params = new URLSearchParams(rawBody);
		const sortedKeys = [...params.keys()].sort();
		let signingString = url;
		for (const key of sortedKeys) {
			signingString += key + params.get(key);
		}

		const expected = crypto.createHmac("sha1", authToken).update(signingString).digest("base64");

		try {
			const sigBuf = Buffer.from(signature, "base64");
			const expectedBuf = Buffer.from(expected, "base64");
			if (sigBuf.length !== expectedBuf.length) return false;
			return crypto.timingSafeEqual(sigBuf, expectedBuf);
		} catch {
			return false;
		}
	},

	normalize(payload: unknown): WebhookEvent[] {
		const parsed = TwilioEventSchema.safeParse(payload);
		if (!parsed.success) return [];

		const { MessageStatus, SmsStatus, MessageSid } = parsed.data;
		const messageStatus = MessageStatus ?? SmsStatus;
		if (!messageStatus) return [];

		const status = STATUS_MAP[messageStatus.toLowerCase()];
		if (!status) return [];

		return [{ providerMsgId: MessageSid, status, metadata: { messageStatus } }];
	},
};
