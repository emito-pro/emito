/**
 * Unit tests for webhook provider verifiers and status normalizers.
 *
 * Tests all 5 providers:
 *   - Resend (Svix HMAC-SHA256)
 *   - SendGrid (ECDSA)
 *   - Twilio SMS (HMAC-SHA1)
 *   - Postmark (HMAC-SHA256)
 *   - Vonage (HS256 JWT + payload_hash)
 *
 * Rules applied:
 * - Rule 1: Assert on EmitoErrorCode values, not error message strings
 * - Rule 15: describe/it naming convention
 * - Rule 19: verify constant-time comparison for secret comparisons
 * - Rule 22: vi.useFakeTimers() for time-dependent behavior (replay windows)
 * - Rule 25: specific matchers over generic ones
 * - Rule 26: assert on shape of return values, not just existence
 */

import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeHeaders(record: Record<string, string>): Headers {
	return new Headers(record);
}

// ----------------------------------------------------------------
// Resend (Svix HMAC-SHA256)
// ----------------------------------------------------------------

const RESEND_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo32PeNksvRsjnSyUdSY=";
const RESEND_MSG_ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const RESEND_TIMESTAMP = "1614265330";
const RESEND_RAW_BODY = '{"email_id":"email_123","type":"email.delivered","to":"user@example.com"}';

function computeResendSignature(
	msgId: string,
	timestamp: string,
	rawBody: string,
	secret: string,
): string {
	const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
	const toSign = `${msgId}.${timestamp}.${rawBody}`;
	const sig = createHmac("sha256", secretBytes).update(toSign).digest("base64");
	return `v1,${sig}`;
}

describe("resendVerifier", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(Number(RESEND_TIMESTAMP) * 1000 + 30_000)); // +30s
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("verify()", () => {
		it("should return true for a valid Svix HMAC-SHA256 signature", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const sig = computeResendSignature(
				RESEND_MSG_ID,
				RESEND_TIMESTAMP,
				RESEND_RAW_BODY,
				RESEND_SECRET,
			);
			const headers = makeHeaders({
				"svix-id": RESEND_MSG_ID,
				"svix-timestamp": RESEND_TIMESTAMP,
				"svix-signature": sig,
			});
			expect(resendVerifier.verify(RESEND_RAW_BODY, headers, RESEND_SECRET)).toBe(true);
		});

		it("should return false for a tampered body", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const sig = computeResendSignature(
				RESEND_MSG_ID,
				RESEND_TIMESTAMP,
				RESEND_RAW_BODY,
				RESEND_SECRET,
			);
			const headers = makeHeaders({
				"svix-id": RESEND_MSG_ID,
				"svix-timestamp": RESEND_TIMESTAMP,
				"svix-signature": sig,
			});
			expect(resendVerifier.verify('{"tampered":true}', headers, RESEND_SECRET)).toBe(false);
		});

		it("should return false for an invalid signature value", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const headers = makeHeaders({
				"svix-id": RESEND_MSG_ID,
				"svix-timestamp": RESEND_TIMESTAMP,
				"svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
			});
			expect(resendVerifier.verify(RESEND_RAW_BODY, headers, RESEND_SECRET)).toBe(false);
		});

		it("should return false when timestamp is more than 5 minutes old (replay protection)", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			vi.setSystemTime(new Date(Number(RESEND_TIMESTAMP) * 1000 + 6 * 60 * 1000));
			const sig = computeResendSignature(
				RESEND_MSG_ID,
				RESEND_TIMESTAMP,
				RESEND_RAW_BODY,
				RESEND_SECRET,
			);
			const headers = makeHeaders({
				"svix-id": RESEND_MSG_ID,
				"svix-timestamp": RESEND_TIMESTAMP,
				"svix-signature": sig,
			});
			expect(resendVerifier.verify(RESEND_RAW_BODY, headers, RESEND_SECRET)).toBe(false);
		});

		it("should return false when svix-id header is missing", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const sig = computeResendSignature(
				RESEND_MSG_ID,
				RESEND_TIMESTAMP,
				RESEND_RAW_BODY,
				RESEND_SECRET,
			);
			const headers = makeHeaders({
				"svix-timestamp": RESEND_TIMESTAMP,
				"svix-signature": sig,
			});
			expect(resendVerifier.verify(RESEND_RAW_BODY, headers, RESEND_SECRET)).toBe(false);
		});

		it("should return false when svix-timestamp header is missing", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const sig = computeResendSignature(
				RESEND_MSG_ID,
				RESEND_TIMESTAMP,
				RESEND_RAW_BODY,
				RESEND_SECRET,
			);
			const headers = makeHeaders({
				"svix-id": RESEND_MSG_ID,
				"svix-signature": sig,
			});
			expect(resendVerifier.verify(RESEND_RAW_BODY, headers, RESEND_SECRET)).toBe(false);
		});

		it("should return false when svix-signature header is missing", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const headers = makeHeaders({
				"svix-id": RESEND_MSG_ID,
				"svix-timestamp": RESEND_TIMESTAMP,
			});
			expect(resendVerifier.verify(RESEND_RAW_BODY, headers, RESEND_SECRET)).toBe(false);
		});
	});

	describe("normalize()", () => {
		it("should map email.delivered to delivered with providerMsgId", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const payload = { type: "email.delivered", data: { email_id: "email_123" } };
			const events = resendVerifier.normalize(payload);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ status: "delivered", providerMsgId: "email_123" });
		});

		it("should map email.sent to sent", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const payload = { type: "email.sent", data: { email_id: "email_sent_1" } };
			const events = resendVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "sent", providerMsgId: "email_sent_1" });
		});

		it("should map email.bounced to bounced", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const payload = { type: "email.bounced", data: { email_id: "email_bounce_1" } };
			const events = resendVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "bounced", providerMsgId: "email_bounce_1" });
		});

		it("should map email.complained to complained", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const payload = { type: "email.complained", data: { email_id: "email_complaint_1" } };
			const events = resendVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "complained", providerMsgId: "email_complaint_1" });
		});

		it("should map email.delivery_delayed to deferred", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const payload = { type: "email.delivery_delayed", data: { email_id: "email_delayed_1" } };
			const events = resendVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "deferred", providerMsgId: "email_delayed_1" });
		});

		it("should return empty array for unknown event types", async () => {
			const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
			const payload = { type: "email.unknown_future_event", data: { email_id: "email_1" } };
			const events = resendVerifier.normalize(payload);
			expect(events).toHaveLength(0);
		});
	});
});

// ----------------------------------------------------------------
// SendGrid (ECDSA)
// ----------------------------------------------------------------

describe("sendgridVerifier", () => {
	let privateKey: string;
	let publicKeyBase64: string;

	beforeEach(() => {
		const kp = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		privateKey = kp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
		// SendGrid verifier expects base64-encoded DER SPKI public key
		publicKeyBase64 = kp.publicKey.export({ type: "spki", format: "der" }).toString("base64");
	});

	function computeSendGridSignature(timestamp: string, rawBody: string, privKey: string): string {
		const toSign = timestamp + rawBody;
		const sign = createSign("SHA256");
		sign.update(toSign);
		sign.end();
		return sign.sign(privKey, "base64");
	}

	describe("verify()", () => {
		it("should return true for a valid ECDSA signature", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const timestamp = "1614265330";
			const rawBody = '[{"event":"delivered","sg_message_id":"sg_msg_1"}]';
			const sig = computeSendGridSignature(timestamp, rawBody, privateKey);
			const headers = makeHeaders({
				"x-twilio-email-event-webhook-signature": sig,
				"x-twilio-email-event-webhook-timestamp": timestamp,
			});
			expect(sendgridVerifier.verify(rawBody, headers, publicKeyBase64)).toBe(true);
		});

		it("should return false for a tampered body", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const timestamp = "1614265330";
			const rawBody = '[{"event":"delivered","sg_message_id":"sg_msg_1"}]';
			const sig = computeSendGridSignature(timestamp, rawBody, privateKey);
			const headers = makeHeaders({
				"x-twilio-email-event-webhook-signature": sig,
				"x-twilio-email-event-webhook-timestamp": timestamp,
			});
			expect(sendgridVerifier.verify('[{"tampered":true}]', headers, publicKeyBase64)).toBe(false);
		});

		it("should return false when signature header is missing", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const rawBody = '[{"event":"delivered","sg_message_id":"sg_msg_1"}]';
			const headers = makeHeaders({ "x-twilio-email-event-webhook-timestamp": "1614265330" });
			expect(sendgridVerifier.verify(rawBody, headers, publicKeyBase64)).toBe(false);
		});

		it("should return false when timestamp header is missing", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const rawBody = '[{"event":"delivered","sg_message_id":"sg_msg_1"}]';
			const headers = makeHeaders({ "x-twilio-email-event-webhook-signature": "invalidsig" });
			expect(sendgridVerifier.verify(rawBody, headers, publicKeyBase64)).toBe(false);
		});
	});

	describe("normalize()", () => {
		it("should normalize a batched array of events", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const payload = [
				{ event: "delivered", sg_message_id: "sg_1" },
				{ event: "bounce", sg_message_id: "sg_2" },
			];
			const events = sendgridVerifier.normalize(payload);
			expect(events).toHaveLength(2);
			expect(events[0]).toMatchObject({ status: "delivered", providerMsgId: "sg_1" });
			expect(events[1]).toMatchObject({ status: "bounced", providerMsgId: "sg_2" });
		});

		it("should map delivered to delivered", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([{ event: "delivered", sg_message_id: "sg_1" }]);
			expect(events[0]).toMatchObject({ status: "delivered" });
		});

		it("should map bounce to bounced", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([{ event: "bounce", sg_message_id: "sg_1" }]);
			expect(events[0]).toMatchObject({ status: "bounced" });
		});

		it("should map spamreport to complained", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([{ event: "spamreport", sg_message_id: "sg_1" }]);
			expect(events[0]).toMatchObject({ status: "complained" });
		});

		it("should map dropped to failed", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([{ event: "dropped", sg_message_id: "sg_1" }]);
			expect(events[0]).toMatchObject({ status: "failed" });
		});

		it("should map deferred to deferred", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([{ event: "deferred", sg_message_id: "sg_1" }]);
			expect(events[0]).toMatchObject({ status: "deferred" });
		});

		it("should map open (human, sg_machine_open=false) to opened", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([
				{ event: "open", sg_machine_open: false, sg_message_id: "sg_1" },
			]);
			expect(events[0]).toMatchObject({ status: "opened" });
		});

		it("should map open with sg_machine_open=true to machine_opened", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([
				{ event: "open", sg_machine_open: true, sg_message_id: "sg_1" },
			]);
			expect(events[0]).toMatchObject({ status: "machine_opened" });
		});

		it("should map click to clicked", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([{ event: "click", sg_message_id: "sg_1" }]);
			expect(events[0]).toMatchObject({ status: "clicked" });
		});

		it("should map unsubscribe to unsubscribed", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([{ event: "unsubscribe", sg_message_id: "sg_1" }]);
			expect(events[0]).toMatchObject({ status: "unsubscribed" });
		});

		it("should return empty array for unknown event types", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const events = sendgridVerifier.normalize([
				{ event: "unknown_event", sg_message_id: "sg_1" },
			]);
			expect(events).toHaveLength(0);
		});

		it("should skip unknown event types when processing a batch (partial failure)", async () => {
			const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
			const payload = [
				{ event: "delivered", sg_message_id: "sg_1" },
				{ event: "unknown_future_event", sg_message_id: "sg_2" },
				{ event: "bounce", sg_message_id: "sg_3" },
			];
			const events = sendgridVerifier.normalize(payload);
			expect(events).toHaveLength(2);
			expect(events[0]).toMatchObject({ status: "delivered" });
			expect(events[1]).toMatchObject({ status: "bounced" });
		});
	});
});

// ----------------------------------------------------------------
// Twilio SMS (HMAC-SHA1)
// ----------------------------------------------------------------

const TWILIO_AUTH_TOKEN = "twilio-auth-token-for-tests";
const TWILIO_WEBHOOK_URL = "https://example.com/emito/webhooks/twilio";
const TWILIO_FORM_PARAMS: Record<string, string> = {
	MessageSid: "SM123456",
	MessageStatus: "delivered",
	To: "+1555000001",
	From: "+1555000002",
};

function computeTwilioSignature(
	url: string,
	params: Record<string, string>,
	authToken: string,
): string {
	const sorted = Object.keys(params)
		.sort()
		.map((k) => `${k}${params[k] ?? ""}`)
		.join("");
	const toSign = url + sorted;
	return createHmac("sha1", authToken).update(toSign).digest("base64");
}

describe("twilioVerifier", () => {
	describe("verify()", () => {
		it("should return true for a valid HMAC-SHA1 signature", async () => {
			const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
			const sig = computeTwilioSignature(TWILIO_WEBHOOK_URL, TWILIO_FORM_PARAMS, TWILIO_AUTH_TOKEN);
			const rawBody = new URLSearchParams(TWILIO_FORM_PARAMS).toString();
			const headers = makeHeaders({
				"x-twilio-signature": sig,
				"x-forwarded-url": TWILIO_WEBHOOK_URL,
			});
			expect(twilioVerifier.verify(rawBody, headers, TWILIO_AUTH_TOKEN)).toBe(true);
		});

		it("should return false for a tampered signature", async () => {
			const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
			const rawBody = new URLSearchParams(TWILIO_FORM_PARAMS).toString();
			const headers = makeHeaders({
				"x-twilio-signature": "AAAAAAAAAAAAAAAAAAAAAAAA==",
				"x-forwarded-url": TWILIO_WEBHOOK_URL,
			});
			expect(twilioVerifier.verify(rawBody, headers, TWILIO_AUTH_TOKEN)).toBe(false);
		});

		it("should return false when X-Twilio-Signature header is missing", async () => {
			const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
			const rawBody = new URLSearchParams(TWILIO_FORM_PARAMS).toString();
			const headers = makeHeaders({ "x-forwarded-url": TWILIO_WEBHOOK_URL });
			expect(twilioVerifier.verify(rawBody, headers, TWILIO_AUTH_TOKEN)).toBe(false);
		});
	});

	describe("normalize()", () => {
		it("should map sent to sent with providerMsgId", async () => {
			const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
			const payload = { MessageSid: "SM123", MessageStatus: "sent" };
			const events = twilioVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "sent", providerMsgId: "SM123" });
		});

		it("should map delivered to delivered", async () => {
			const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
			const payload = { MessageSid: "SM123", MessageStatus: "delivered" };
			const events = twilioVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "delivered", providerMsgId: "SM123" });
		});

		it("should map undelivered to bounced (architecture doc: permanent rejection)", async () => {
			const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
			const payload = { MessageSid: "SM123", MessageStatus: "undelivered" };
			const events = twilioVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "bounced", providerMsgId: "SM123" });
		});

		it("should map failed to failed", async () => {
			const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
			const payload = { MessageSid: "SM123", MessageStatus: "failed" };
			const events = twilioVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "failed", providerMsgId: "SM123" });
		});

		it("should return empty array for untracked statuses (e.g. queued)", async () => {
			const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
			const payload = { MessageSid: "SM123", MessageStatus: "queued" };
			const events = twilioVerifier.normalize(payload);
			expect(events).toHaveLength(0);
		});
	});
});

// ----------------------------------------------------------------
// Postmark (HMAC-SHA256)
// ----------------------------------------------------------------

const POSTMARK_SECRET = "postmark-webhook-secret-for-tests";
const POSTMARK_RAW_BODY =
	'{"RecordType":"Delivery","MessageID":"msg-postmark-1","DeliveredAt":"2026-01-01T00:00:00Z"}';

function computePostmarkSignature(rawBody: string, secret: string): string {
	return createHmac("sha256", secret).update(rawBody).digest("base64");
}

describe("postmarkVerifier", () => {
	describe("verify()", () => {
		it("should return true for a valid HMAC-SHA256 signature", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const sig = computePostmarkSignature(POSTMARK_RAW_BODY, POSTMARK_SECRET);
			const headers = makeHeaders({ "x-postmark-signature": sig });
			expect(postmarkVerifier.verify(POSTMARK_RAW_BODY, headers, POSTMARK_SECRET)).toBe(true);
		});

		it("should return false for a tampered body", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const sig = computePostmarkSignature(POSTMARK_RAW_BODY, POSTMARK_SECRET);
			const headers = makeHeaders({ "x-postmark-signature": sig });
			expect(postmarkVerifier.verify('{"tampered":true}', headers, POSTMARK_SECRET)).toBe(false);
		});

		it("should return false for an invalid signature", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const headers = makeHeaders({ "x-postmark-signature": "invalidsig==" });
			expect(postmarkVerifier.verify(POSTMARK_RAW_BODY, headers, POSTMARK_SECRET)).toBe(false);
		});

		it("should return false when signature header is missing", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			expect(postmarkVerifier.verify(POSTMARK_RAW_BODY, new Headers(), POSTMARK_SECRET)).toBe(
				false,
			);
		});
	});

	describe("normalize()", () => {
		it("should map Delivery to delivered", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const payload = { RecordType: "Delivery", MessageID: "pm_1" };
			const events = postmarkVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "delivered", providerMsgId: "pm_1" });
		});

		it("should map hard bounce (TypeCode 1) to bounced", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const payload = { RecordType: "Bounce", Type: "HardBounce", TypeCode: 1, MessageID: "pm_2" };
			const events = postmarkVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "bounced", providerMsgId: "pm_2" });
		});

		it("should map soft bounce (TypeCode != 1) to deferred", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const payload = { RecordType: "Bounce", Type: "SoftBounce", TypeCode: 2, MessageID: "pm_3" };
			const events = postmarkVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "deferred", providerMsgId: "pm_3" });
		});

		it("should map SpamComplaint to complained", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const payload = { RecordType: "SpamComplaint", MessageID: "pm_4" };
			const events = postmarkVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "complained", providerMsgId: "pm_4" });
		});

		it("should map Open to opened", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const payload = { RecordType: "Open", MessageID: "pm_5" };
			const events = postmarkVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "opened", providerMsgId: "pm_5" });
		});

		it("should map Click to clicked", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const payload = { RecordType: "Click", MessageID: "pm_6" };
			const events = postmarkVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "clicked", providerMsgId: "pm_6" });
		});

		it("should map SubscriptionChange to unsubscribed", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const payload = { RecordType: "SubscriptionChange", MessageID: "pm_7" };
			const events = postmarkVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "unsubscribed", providerMsgId: "pm_7" });
		});

		it("should return empty array for unknown RecordType", async () => {
			const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
			const payload = { RecordType: "UnknownFutureType", MessageID: "pm_8" };
			const events = postmarkVerifier.normalize(payload);
			expect(events).toHaveLength(0);
		});
	});
});

// ----------------------------------------------------------------
// Vonage (HS256 JWT + payload_hash)
// ----------------------------------------------------------------

const VONAGE_SECRET = "vonage-jwt-signing-secret-for-tests";

function computeSha256Hex(data: string): string {
	const { createHash } = require("node:crypto") as typeof import("node:crypto");
	return createHash("sha256").update(data).digest("hex");
}

function buildVonageJwt(
	rawBody: string,
	secret: string,
	overrides: {
		payload_hash?: string;
		exp?: number;
		iat?: number;
	} = {},
): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const nowSec = Math.floor(Date.now() / 1000);
	const claims = {
		iat: overrides.iat ?? nowSec - 10,
		exp: overrides.exp ?? nowSec + 300,
		payload_hash: overrides.payload_hash ?? computeSha256Hex(rawBody),
	};
	const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
	const toSign = `${header}.${payload}`;
	const sig = createHmac("sha256", secret).update(toSign).digest("base64url");
	return `${toSign}.${sig}`;
}

describe("vonageVerifier", () => {
	const rawBody =
		'{"message_uuid":"msg-vonage-1","status":"delivered","to":"447700900000","from":"447700900001"}';

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("verify()", () => {
		it("should return true for a valid HS256 JWT with matching payload_hash", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const jwt = buildVonageJwt(rawBody, VONAGE_SECRET);
			const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
			expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(true);
		});

		it("should return false for a tampered body (payload_hash mismatch)", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const jwt = buildVonageJwt(rawBody, VONAGE_SECRET);
			const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
			expect(vonageVerifier.verify('{"tampered":true}', headers, VONAGE_SECRET)).toBe(false);
		});

		it("should return false when JWT is signed with the wrong secret", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const jwt = buildVonageJwt(rawBody, "wrong-secret");
			const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
			expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
		});

		it("should return false when Authorization header is missing", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			expect(vonageVerifier.verify(rawBody, new Headers(), VONAGE_SECRET)).toBe(false);
		});

		it("should return false when JWT is expired", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const nowSec = Math.floor(Date.now() / 1000);
			const jwt = buildVonageJwt(rawBody, VONAGE_SECRET, {
				iat: nowSec - 700, // way in the past, beyond 5m+30s tolerance
				exp: nowSec - 100,
			});
			const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
			expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
		});
	});

	describe("normalize()", () => {
		it("should map delivered to delivered with providerMsgId", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const payload = { message_uuid: "msg-vonage-1", status: "delivered" };
			const events = vonageVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "delivered", providerMsgId: "msg-vonage-1" });
		});

		it("should map rejected to failed", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const payload = { message_uuid: "msg-vonage-2", status: "rejected" };
			const events = vonageVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "failed", providerMsgId: "msg-vonage-2" });
		});

		it("should map failed to failed", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const payload = { message_uuid: "msg-vonage-3", status: "failed" };
			const events = vonageVerifier.normalize(payload);
			expect(events[0]).toMatchObject({ status: "failed", providerMsgId: "msg-vonage-3" });
		});

		it("should return empty array for untracked statuses", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const payload = { message_uuid: "msg-vonage-4", status: "submitted" };
			const events = vonageVerifier.normalize(payload);
			expect(events).toHaveLength(0);
		});

		it("should return empty array when status is missing", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const payload = { message_uuid: "msg-vonage-5" };
			const events = vonageVerifier.normalize(payload);
			expect(events).toHaveLength(0);
		});

		it("should return empty array when message_uuid is missing", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			const payload = { status: "delivered" };
			const events = vonageVerifier.normalize(payload);
			expect(events).toHaveLength(0);
		});

		it("should return empty array for non-object payload", async () => {
			const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
			expect(vonageVerifier.normalize(null)).toHaveLength(0);
			expect(vonageVerifier.normalize("string")).toHaveLength(0);
			expect(vonageVerifier.normalize(undefined)).toHaveLength(0);
		});
	});
});

// ----------------------------------------------------------------
// Edge-case coverage: uncovered branches
// ----------------------------------------------------------------

describe("resendVerifier edge cases", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(Number(RESEND_TIMESTAMP) * 1000 + 30_000));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should return false when timestamp is NaN", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		const sig = computeResendSignature(
			RESEND_MSG_ID,
			RESEND_TIMESTAMP,
			RESEND_RAW_BODY,
			RESEND_SECRET,
		);
		const headers = makeHeaders({
			"svix-id": RESEND_MSG_ID,
			"svix-timestamp": "not-a-number",
			"svix-signature": sig,
		});
		expect(resendVerifier.verify(RESEND_RAW_BODY, headers, RESEND_SECRET)).toBe(false);
	});

	it("should handle secret without whsec_ prefix", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		const rawSecret = RESEND_SECRET.replace(/^whsec_/, "");
		const sig = computeResendSignature(
			RESEND_MSG_ID,
			RESEND_TIMESTAMP,
			RESEND_RAW_BODY,
			RESEND_SECRET,
		);
		const headers = makeHeaders({
			"svix-id": RESEND_MSG_ID,
			"svix-timestamp": RESEND_TIMESTAMP,
			"svix-signature": sig,
		});
		// Using raw secret (without prefix) should still verify since the code strips the prefix
		expect(resendVerifier.verify(RESEND_RAW_BODY, headers, rawSecret)).toBe(true);
	});

	it("should handle multiple signatures in svix-signature header", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		const sig = computeResendSignature(
			RESEND_MSG_ID,
			RESEND_TIMESTAMP,
			RESEND_RAW_BODY,
			RESEND_SECRET,
		);
		const headers = makeHeaders({
			"svix-id": RESEND_MSG_ID,
			"svix-timestamp": RESEND_TIMESTAMP,
			"svix-signature": `v1,invalidsig== ${sig}`,
		});
		expect(resendVerifier.verify(RESEND_RAW_BODY, headers, RESEND_SECRET)).toBe(true);
	});

	it("should return false for signature entry without comma separator", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		const headers = makeHeaders({
			"svix-id": RESEND_MSG_ID,
			"svix-timestamp": RESEND_TIMESTAMP,
			"svix-signature": "noseparator",
		});
		expect(resendVerifier.verify(RESEND_RAW_BODY, headers, RESEND_SECRET)).toBe(false);
	});

	it("should return empty array when normalize receives non-object payload", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		expect(resendVerifier.normalize(null)).toHaveLength(0);
		expect(resendVerifier.normalize("string")).toHaveLength(0);
		expect(resendVerifier.normalize(undefined)).toHaveLength(0);
	});

	it("should return empty array when normalize payload has no type", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		expect(resendVerifier.normalize({ data: { email_id: "e1" } })).toHaveLength(0);
	});

	it("should return empty array when normalize payload has no data", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		expect(resendVerifier.normalize({ type: "email.delivered" })).toHaveLength(0);
	});

	it("should return empty array when normalize payload data has no email_id", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		expect(resendVerifier.normalize({ type: "email.delivered", data: {} })).toHaveLength(0);
	});
});

describe("sendgridVerifier edge cases", () => {
	it("should return empty array for non-array payload in normalize", async () => {
		const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
		expect(sendgridVerifier.normalize({ event: "delivered" })).toHaveLength(0);
		expect(sendgridVerifier.normalize(null)).toHaveLength(0);
	});

	it("should skip items without event type in normalize", async () => {
		const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
		const events = sendgridVerifier.normalize([{ sg_message_id: "sg_1" }]);
		expect(events).toHaveLength(0);
	});

	it("should skip items without sg_message_id in normalize", async () => {
		const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
		const events = sendgridVerifier.normalize([{ event: "delivered" }]);
		expect(events).toHaveLength(0);
	});

	it("should skip non-object items in normalize array", async () => {
		const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
		const events = sendgridVerifier.normalize([null, "string", 42]);
		expect(events).toHaveLength(0);
	});

	it("should return false for invalid/corrupt public key in verify", async () => {
		const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
		const rawBody = '[{"event":"delivered","sg_message_id":"sg_1"}]';
		const headers = makeHeaders({
			"x-twilio-email-event-webhook-signature": "invalidsig",
			"x-twilio-email-event-webhook-timestamp": "1614265330",
		});
		expect(sendgridVerifier.verify(rawBody, headers, "not-a-valid-key")).toBe(false);
	});
});

describe("postmarkVerifier edge cases", () => {
	it("should return empty array when Bounce has no MessageID", async () => {
		const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
		const events = postmarkVerifier.normalize({ RecordType: "Bounce", TypeCode: 1 });
		expect(events).toHaveLength(0);
	});

	it("should return empty array when non-Bounce has no MessageID", async () => {
		const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
		const events = postmarkVerifier.normalize({ RecordType: "Delivery" });
		expect(events).toHaveLength(0);
	});

	it("should return empty array when RecordType is missing", async () => {
		const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
		const events = postmarkVerifier.normalize({ MessageID: "pm_1" });
		expect(events).toHaveLength(0);
	});

	it("should return empty array for non-object payload", async () => {
		const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
		expect(postmarkVerifier.normalize(null)).toHaveLength(0);
		expect(postmarkVerifier.normalize("string")).toHaveLength(0);
	});

	it("should return false when signature has different length than expected", async () => {
		const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
		const headers = makeHeaders({ "x-postmark-signature": "c2hvcnQ=" }); // "short" in base64
		expect(postmarkVerifier.verify(POSTMARK_RAW_BODY, headers, POSTMARK_SECRET)).toBe(false);
	});
});

describe("twilioVerifier edge cases", () => {
	it("should use SmsStatus fallback when MessageStatus is absent", async () => {
		const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
		const payload = { MessageSid: "SM999", SmsStatus: "delivered" };
		const events = twilioVerifier.normalize(payload);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ status: "delivered", providerMsgId: "SM999" });
	});

	it("should return empty array when MessageSid is missing", async () => {
		const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
		const events = twilioVerifier.normalize({ MessageStatus: "delivered" });
		expect(events).toHaveLength(0);
	});

	it("should return empty array for non-object payload", async () => {
		const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
		expect(twilioVerifier.normalize(null)).toHaveLength(0);
		expect(twilioVerifier.normalize("string")).toHaveLength(0);
	});

	it("should return false when x-forwarded-url is also missing (empty URL fallback)", async () => {
		const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
		const rawBody = new URLSearchParams(TWILIO_FORM_PARAMS).toString();
		const headers = makeHeaders({ "x-twilio-signature": "invalidsig==" });
		expect(twilioVerifier.verify(rawBody, headers, TWILIO_AUTH_TOKEN)).toBe(false);
	});

	it("should return false when signature length differs from expected", async () => {
		const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
		const rawBody = new URLSearchParams(TWILIO_FORM_PARAMS).toString();
		const headers = makeHeaders({
			"x-twilio-signature": "c2hvcnQ=", // "short" — wrong length
			"x-forwarded-url": TWILIO_WEBHOOK_URL,
		});
		expect(twilioVerifier.verify(rawBody, headers, TWILIO_AUTH_TOKEN)).toBe(false);
	});
});

describe("vonageVerifier edge cases", () => {
	const rawBody = '{"message_uuid":"msg-vonage-edge","status":"delivered"}';

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should return false when Authorization header is not Bearer", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const headers = makeHeaders({ authorization: "Basic dXNlcjpwYXNz" });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
	});

	it("should return false when JWT has wrong number of parts", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const headers = makeHeaders({ authorization: "Bearer only.twoparts" });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
	});

	it("should return false when JWT uses non-HS256 algorithm", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		// Build a JWT with alg: "none"
		const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
		const nowSec = Math.floor(Date.now() / 1000);
		const claims = {
			iat: nowSec - 10,
			exp: nowSec + 300,
			payload_hash: computeSha256Hex(rawBody),
		};
		const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
		// Sign with HS256 anyway so signature check passes, but alg claim is wrong
		const sig = createHmac("sha256", VONAGE_SECRET)
			.update(`${header}.${payload}`)
			.digest("base64url");
		const jwt = `${header}.${payload}.${sig}`;
		const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
	});

	it("should return false when JWT is missing payload_hash claim", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
		const nowSec = Math.floor(Date.now() / 1000);
		const claims = { iat: nowSec - 10, exp: nowSec + 300 }; // no payload_hash
		const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
		const sig = createHmac("sha256", VONAGE_SECRET)
			.update(`${header}.${payload}`)
			.digest("base64url");
		const jwt = `${header}.${payload}.${sig}`;
		const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
	});

	it("should return false when iat is too old (beyond 5m+30s tolerance)", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const jwt = buildVonageJwt(rawBody, VONAGE_SECRET, {
			iat: Math.floor(Date.now() / 1000) - 400, // 6m40s old
		});
		const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
	});

	it("should return false when JWT payload is malformed JSON", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
		const payload = Buffer.from("not-valid-json").toString("base64url");
		const sig = createHmac("sha256", VONAGE_SECRET)
			.update(`${header}.${payload}`)
			.digest("base64url");
		const jwt = `${header}.${payload}.${sig}`;
		const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
	});

	it("should return false when payload_hash claim is a number instead of a string (D-039: Zod rejects non-string)", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
		const nowSec = Math.floor(Date.now() / 1000);
		const claims = { iat: nowSec - 10, exp: nowSec + 300, payload_hash: 12345 };
		const payloadPart = Buffer.from(JSON.stringify(claims)).toString("base64url");
		const sig = createHmac("sha256", VONAGE_SECRET)
			.update(`${header}.${payloadPart}`)
			.digest("base64url");
		const jwt = `${header}.${payloadPart}.${sig}`;
		const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// D-034: Zod safeParse — malformed payloads return [] gracefully
// ---------------------------------------------------------------------------

describe("Zod safeParse — malformed payload graceful degradation (D-034)", () => {
	it("resend: returns [] for payload where data.email_id is a number instead of string", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		const payload = { type: "email.delivered", data: { email_id: 12345 } };
		expect(resendVerifier.normalize(payload)).toHaveLength(0);
	});

	it("resend: returns [] for payload where type is a number instead of string", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		const payload = { type: 42, data: { email_id: "email_1" } };
		expect(resendVerifier.normalize(payload)).toHaveLength(0);
	});

	it("sendgrid: returns [] for array item where sg_message_id is a number instead of string", async () => {
		const { sendgridVerifier } = await import("../../endpoints/webhooks/providers/sendgrid.js");
		const payload = [{ event: "delivered", sg_message_id: 99999 }];
		expect(sendgridVerifier.normalize(payload)).toHaveLength(0);
	});

	it("twilio: returns [] for payload where MessageSid is a number instead of string", async () => {
		const { twilioVerifier } = await import("../../endpoints/webhooks/providers/twilio.js");
		const payload = { MessageSid: 12345, MessageStatus: "delivered" };
		expect(twilioVerifier.normalize(payload)).toHaveLength(0);
	});

	it("postmark: returns [] for payload where MessageID is a number instead of string", async () => {
		const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
		const payload = { RecordType: "Delivery", MessageID: 12345 };
		expect(postmarkVerifier.normalize(payload)).toHaveLength(0);
	});

	it("vonage: returns [] for payload where message_uuid is a number instead of string", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const payload = { message_uuid: 999, status: "delivered" };
		expect(vonageVerifier.normalize(payload)).toHaveLength(0);
	});

	it("vonage: returns [] for payload where status is a number instead of string", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const payload = { message_uuid: "msg-1", status: 1 };
		expect(vonageVerifier.normalize(payload)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// D-039: vonage timingSafeEqual uses hex-decoded buffers (32-byte comparison)
// ---------------------------------------------------------------------------

describe("vonageVerifier — hex binary comparison (D-039)", () => {
	const rawBody = '{"message_uuid":"vonage-hex-test","status":"delivered"}';

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should verify a JWT whose payload_hash is a lowercase hex SHA-256 string", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const jwt = buildVonageJwt(rawBody, VONAGE_SECRET);
		const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(true);
	});

	it("should reject a JWT where payload_hash hex does not match the body", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const differentBody = '{"message_uuid":"different","status":"failed"}';
		const jwt = buildVonageJwt(differentBody, VONAGE_SECRET);
		const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
	});

	it("should reject a tampered payload_hash that is the wrong hex value", async () => {
		const { vonageVerifier } = await import("../../endpoints/webhooks/providers/vonage.js");
		const jwt = buildVonageJwt(rawBody, VONAGE_SECRET, {
			payload_hash: "a".repeat(64),
		});
		const headers = makeHeaders({ authorization: `Bearer ${jwt}` });
		expect(vonageVerifier.verify(rawBody, headers, VONAGE_SECRET)).toBe(false);
	});
});
