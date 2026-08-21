import crypto from "node:crypto";
import type { DeliveryStatus } from "@emito/types";
import { z } from "zod";
import type { WebhookEvent, WebhookVerifier } from "../types.js";

const RECORD_TYPE_MAP: Record<string, DeliveryStatus> = {
	Delivery: "delivered",
	SpamComplaint: "complained",
	Open: "opened",
	Click: "clicked",
	SubscriptionChange: "unsubscribed",
};

const PostmarkBounceSchema = z.object({
	RecordType: z.literal("Bounce"),
	TypeCode: z.number().optional(),
	MessageID: z.string(),
});

const PostmarkEventSchema = z.object({
	RecordType: z.string(),
	MessageID: z.string(),
});

export const postmarkVerifier: WebhookVerifier = {
	verify(rawBody: string, headers: Headers, secret: string): boolean {
		const signature = headers.get("x-postmark-signature");
		if (!signature) return false;

		const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");

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
		if (!payload || typeof payload !== "object") return [];

		// Try bounce first (has literal RecordType)
		const bounce = PostmarkBounceSchema.safeParse(payload);
		if (bounce.success) {
			const { TypeCode, MessageID } = bounce.data;
			const status: DeliveryStatus = TypeCode === 1 ? "bounced" : "deferred";
			return [
				{
					providerMsgId: MessageID,
					status,
					metadata: { recordType: "Bounce", typeCode: TypeCode },
				},
			];
		}

		// Try generic event
		const event = PostmarkEventSchema.safeParse(payload);
		if (!event.success) return [];

		const { RecordType, MessageID } = event.data;
		const status = RECORD_TYPE_MAP[RecordType];
		if (!status) return [];

		return [{ providerMsgId: MessageID, status, metadata: { recordType: RecordType } }];
	},
};
