import crypto from "node:crypto";
import type { DeliveryStatus } from "@emito/types";
import { z } from "zod";
import type { WebhookEvent, WebhookVerifier } from "../types.js";

const STATUS_MAP: Record<string, DeliveryStatus> = {
	delivered: "delivered",
	bounce: "bounced",
	spamreport: "complained",
	dropped: "failed",
	deferred: "deferred",
	open: "opened",
	click: "clicked",
	unsubscribe: "unsubscribed",
};

const SendGridEventSchema = z.object({
	event: z.string(),
	sg_message_id: z.string(),
	sg_machine_open: z.boolean().optional(),
});

export const sendgridVerifier: WebhookVerifier = {
	verify(rawBody: string, headers: Headers, publicKeyBase64: string): boolean {
		const signature = headers.get("x-twilio-email-event-webhook-signature");
		const timestamp = headers.get("x-twilio-email-event-webhook-timestamp");

		if (!signature || !timestamp) return false;

		try {
			const publicKey = crypto.createPublicKey({
				key: Buffer.from(publicKeyBase64, "base64"),
				format: "der",
				type: "spki",
			});

			const payload = timestamp + rawBody;
			const signatureBytes = Buffer.from(signature, "base64");

			return crypto.verify("sha256", Buffer.from(payload), publicKey, signatureBytes);
		} catch {
			return false;
		}
	},

	normalize(payload: unknown): WebhookEvent[] {
		// SendGrid sends a batched array of events
		if (!Array.isArray(payload)) return [];

		const events: WebhookEvent[] = [];
		for (const item of payload) {
			const parsed = SendGridEventSchema.safeParse(item);
			if (!parsed.success) continue;

			const { event: eventType, sg_message_id, sg_machine_open } = parsed.data;

			let status = STATUS_MAP[eventType];
			if (!status) continue;

			// Detect machine opens via sg_machine_open flag
			if (eventType === "open" && sg_machine_open === true) {
				status = "machine_opened";
			}

			events.push({ providerMsgId: sg_message_id, status, metadata: { event: eventType } });
		}
		return events;
	},
};
