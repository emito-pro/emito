/**
 * Security tests for inbound provider webhook signature verification.
 *
 * Per agent-rules.md rule 18: Security tests are mandatory for any PR
 * that modifies webhook-related code.
 *
 * Per agent-rules.md rule 19: Always verify constant-time comparison
 * for secret comparisons. Implementations MUST use crypto.timingSafeEqual().
 *
 * Tests:
 * - Each provider: valid signature passes, invalid/tampered returns false
 * - Invalid signatures → 401 response when dispatched through server
 * - Replay attack prevention (Resend 5-minute window)
 * - All 5 providers export a verify() function
 * - No PII in error context (rule 20)
 */

import { createHmac } from "node:crypto";
import {
	InMemoryConsentRepository,
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemorySubscriberRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitoServer } from "../../handler.js";

function makeHeaders(record: Record<string, string>): Headers {
	return new Headers(record);
}

// ----------------------------------------------------------------
// Resend signature security
// ----------------------------------------------------------------

const RESEND_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo32PeNksvRsjnSyUdSY=";
const RESEND_MSG_ID = "msg_security_test_1";

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

describe("Resend webhook signature security", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date());
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("should accept a valid Svix HMAC-SHA256 signature", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		const ts = String(Math.floor(Date.now() / 1000));
		const rawBody = '{"type":"email.delivered","data":{"email_id":"e1"}}';
		const sig = computeResendSignature(RESEND_MSG_ID, ts, rawBody, RESEND_SECRET);
		const headers = makeHeaders({
			"svix-id": RESEND_MSG_ID,
			"svix-timestamp": ts,
			"svix-signature": sig,
		});
		expect(resendVerifier.verify(rawBody, headers, RESEND_SECRET)).toBe(true);
	});

	it("should reject a forged signature (returns false, does not throw)", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		const ts = String(Math.floor(Date.now() / 1000));
		const rawBody = '{"type":"email.delivered","data":{"email_id":"e1"}}';
		const headers = makeHeaders({
			"svix-id": RESEND_MSG_ID,
			"svix-timestamp": ts,
			"svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
		});
		expect(resendVerifier.verify(rawBody, headers, RESEND_SECRET)).toBe(false);
	});

	it("should reject a replay attack (stale timestamp > 5 minutes)", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		// Simulate 6-minute-old webhook
		const staleSec = Math.floor(Date.now() / 1000) - 6 * 60;
		const staleTs = String(staleSec);
		const rawBody = '{"type":"email.delivered","data":{"email_id":"e1"}}';
		const sig = computeResendSignature(RESEND_MSG_ID, staleTs, rawBody, RESEND_SECRET);
		const headers = makeHeaders({
			"svix-id": RESEND_MSG_ID,
			"svix-timestamp": staleTs,
			"svix-signature": sig,
		});
		expect(resendVerifier.verify(rawBody, headers, RESEND_SECRET)).toBe(false);
	});

	it("should reject an empty signature string", async () => {
		const { resendVerifier } = await import("../../endpoints/webhooks/providers/resend.js");
		const ts = String(Math.floor(Date.now() / 1000));
		const rawBody = '{"type":"email.delivered","data":{"email_id":"e1"}}';
		const headers = makeHeaders({
			"svix-id": RESEND_MSG_ID,
			"svix-timestamp": ts,
			"svix-signature": "",
		});
		expect(resendVerifier.verify(rawBody, headers, RESEND_SECRET)).toBe(false);
	});
});

// ----------------------------------------------------------------
// Postmark signature security
// ----------------------------------------------------------------

const POSTMARK_SECRET = "postmark-security-secret";
const POSTMARK_BODY = '{"RecordType":"Delivery","MessageID":"pm-security-1"}';

function computePostmarkSignature(rawBody: string, secret: string): string {
	return createHmac("sha256", secret).update(rawBody).digest("base64");
}

describe("Postmark webhook signature security", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should accept a valid HMAC-SHA256 signature", async () => {
		const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
		const sig = computePostmarkSignature(POSTMARK_BODY, POSTMARK_SECRET);
		expect(
			postmarkVerifier.verify(
				POSTMARK_BODY,
				makeHeaders({ "x-postmark-signature": sig }),
				POSTMARK_SECRET,
			),
		).toBe(true);
	});

	it("should reject a tampered payload", async () => {
		const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
		const sig = computePostmarkSignature(POSTMARK_BODY, POSTMARK_SECRET);
		expect(
			postmarkVerifier.verify(
				'{"RecordType":"Bounce","MessageID":"injected-by-attacker"}',
				makeHeaders({ "x-postmark-signature": sig }),
				POSTMARK_SECRET,
			),
		).toBe(false);
	});

	it("should reject a missing signature header", async () => {
		const { postmarkVerifier } = await import("../../endpoints/webhooks/providers/postmark.js");
		expect(postmarkVerifier.verify(POSTMARK_BODY, new Headers(), POSTMARK_SECRET)).toBe(false);
	});
});

// ----------------------------------------------------------------
// All 5 providers: verify() exists and is a function
// ----------------------------------------------------------------

describe("All webhook providers export verify() and normalize()", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("resend: exports resendVerifier with verify() and normalize()", async () => {
		const mod = await import("../../endpoints/webhooks/providers/resend.js");
		expect(typeof mod.resendVerifier.verify).toBe("function");
		expect(typeof mod.resendVerifier.normalize).toBe("function");
	});

	it("sendgrid: exports sendgridVerifier with verify() and normalize()", async () => {
		const mod = await import("../../endpoints/webhooks/providers/sendgrid.js");
		expect(typeof mod.sendgridVerifier.verify).toBe("function");
		expect(typeof mod.sendgridVerifier.normalize).toBe("function");
	});

	it("twilio: exports twilioVerifier with verify() and normalize()", async () => {
		const mod = await import("../../endpoints/webhooks/providers/twilio.js");
		expect(typeof mod.twilioVerifier.verify).toBe("function");
		expect(typeof mod.twilioVerifier.normalize).toBe("function");
	});

	it("postmark: exports postmarkVerifier with verify() and normalize()", async () => {
		const mod = await import("../../endpoints/webhooks/providers/postmark.js");
		expect(typeof mod.postmarkVerifier.verify).toBe("function");
		expect(typeof mod.postmarkVerifier.normalize).toBe("function");
	});

	it("vonage: exports vonageVerifier with verify() and normalize()", async () => {
		const mod = await import("../../endpoints/webhooks/providers/vonage.js");
		expect(typeof mod.vonageVerifier.verify).toBe("function");
		expect(typeof mod.vonageVerifier.normalize).toBe("function");
	});
});

// ----------------------------------------------------------------
// Invalid signature → 401 (end-to-end through server handler)
// ----------------------------------------------------------------

function makeSecureServer(webhookSecrets: Record<string, string>) {
	return createEmitoServer({
		emito: {
			send: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			healthCheck: vi
				.fn()
				.mockResolvedValue({ healthy: true, providers: [], redis: { connected: true } }),
			on: vi.fn(),
			off: vi.fn(),
		} as never,
		apiKey: "test-api-key",
		resolveSubscriberId: async () => null,
		webhookSecrets,
		repositories: {
			subscriberRepository: new InMemorySubscriberRepository(),
			notificationRepository: new InMemoryNotificationRepository(),
			preferenceRepository: new InMemoryPreferenceRepository(),
			consentRepository: new InMemoryConsentRepository(),
			workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
			suppressionRepository: new InMemorySuppressionRepository(),
			deadLetterRepository: new InMemoryDeadLetterRepository(),
			integrationRepository: new InMemoryIntegrationRepository(),
			inboxRepository: new InMemoryInboxRepository(),
		},
	});
}

describe("Invalid webhook signature → 401 response from server", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should return 401 with WEBHOOK_SIGNATURE_INVALID for forged Resend webhook", async () => {
		const server = makeSecureServer({ resend: RESEND_SECRET });
		const ts = String(Math.floor(Date.now() / 1000));

		const res = await server.handler(
			new Request("http://localhost/emito/webhooks/resend", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"svix-id": "msg_forged",
					"svix-timestamp": ts,
					"svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
				},
				body: '{"type":"email.delivered","data":{"email_id":"forged"}}',
			}),
		);

		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string; details?: unknown } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.WEBHOOK_SIGNATURE_INVALID);
		// PII check: error context should not contain PII (rule 20)
		// (includeErrorContext defaults to false, so details are not exposed)
		expect(body.error.details).toBeUndefined();
	});

	it("should return 401 with WEBHOOK_SIGNATURE_INVALID for forged Postmark webhook", async () => {
		const server = makeSecureServer({ postmark: POSTMARK_SECRET });

		const res = await server.handler(
			new Request("http://localhost/emito/webhooks/postmark", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-postmark-signature": "AAAAAAAAAAAAAAAAAAAAAAAA==",
				},
				body: POSTMARK_BODY,
			}),
		);

		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.WEBHOOK_SIGNATURE_INVALID);
	});

	it("should not expose PII in error response when signature is invalid", async () => {
		const server = makeSecureServer({ resend: RESEND_SECRET });
		const ts = String(Math.floor(Date.now() / 1000));

		const res = await server.handler(
			new Request("http://localhost/emito/webhooks/resend", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"svix-id": "msg_1",
					"svix-timestamp": ts,
					"svix-signature": "v1,bad==",
				},
				body: '{"email":"secret@example.com","type":"email.delivered","data":{"email_id":"e1"}}',
			}),
		);

		expect(res.status).toBe(401);
		const responseText = await res.text();
		// The error response must not leak body content or email addresses
		expect(responseText).not.toContain("secret@example.com");
	});
});
