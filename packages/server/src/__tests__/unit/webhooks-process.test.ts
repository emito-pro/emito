/**
 * Unit tests for the webhook processing pipeline (process.ts).
 *
 * Tests:
 * - Invalid signature → throws WEBHOOK_SIGNATURE_INVALID, no payload processing
 * - normalize() called after successful verification
 * - transitionStatus() called for each normalized event found
 * - Hard bounce / spam complaint → addSuppression() called
 * - Non-suppressable statuses (delivered) → no suppression
 * - Unknown providerMsgId → graceful no-op
 * - Batch events processed independently
 * - Idempotency: invalid state transitions are skipped (canTransition guard)
 *
 * Rules applied:
 * - Rule 1: Assert on EmitoErrorCode values, not message strings
 * - Rule 10: Never mock the module under test
 * - Rule 12: Use in-memory repository stubs for unit tests
 * - Rule 15: describe/it naming convention
 * - Rule 28: Assert on call arguments for mock function verifications
 */

import { InMemoryNotificationRepository, InMemorySuppressionRepository } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processWebhook } from "../../endpoints/webhooks/process.js";
import type { WebhookEvent, WebhookVerifier } from "../../endpoints/webhooks/types.js";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeMockVerifier(opts: {
	verifyResult: boolean;
	events?: WebhookEvent[];
}): WebhookVerifier {
	return {
		verify: vi.fn().mockReturnValue(opts.verifyResult),
		normalize: vi.fn().mockReturnValue(opts.events ?? []),
	};
}

function makeHeaders(record: Record<string, string>): Headers {
	return new Headers(record);
}

const VALID_BODY = '{"test":true}';

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("processWebhook()", () => {
	let notificationRepo: InMemoryNotificationRepository;
	let suppressionRepo: InMemorySuppressionRepository;

	beforeEach(() => {
		notificationRepo = new InMemoryNotificationRepository();
		suppressionRepo = new InMemorySuppressionRepository();
	});

	it("should throw WEBHOOK_SIGNATURE_INVALID when verifier.verify returns false", async () => {
		const verifier = makeMockVerifier({ verifyResult: false });

		await expect(
			processWebhook({
				provider: "resend",
				verifier,
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
			}),
		).rejects.toMatchObject({ code: EMITO_ERROR_CODE.WEBHOOK_SIGNATURE_INVALID });
	});

	it("should NOT call normalize() when signature is invalid", async () => {
		const verifier = makeMockVerifier({ verifyResult: false });

		await expect(
			processWebhook({
				provider: "resend",
				verifier,
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
			}),
		).rejects.toThrow();

		expect(verifier.normalize).not.toHaveBeenCalled();
	});

	it("should call normalize() after successful signature verification", async () => {
		const verifier = makeMockVerifier({ verifyResult: true, events: [] });

		await processWebhook({
			provider: "resend",
			verifier,
			rawBody: VALID_BODY,
			headers: makeHeaders({}),
			secret: "secret",
			deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
		});

		expect(verifier.normalize).toHaveBeenCalledOnce();
	});

	it("should call notificationRepository.updateStatus() for each normalized event with matching providerMsgId", async () => {
		const notification = await notificationRepo.create({
			id: "notif_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
		});
		// Set providerMsgId on the record
		await notificationRepo.updateStatus(notification.id, "sent", {
			providerMsgId: "provider_msg_1",
		});

		const verifier = makeMockVerifier({
			verifyResult: true,
			events: [{ providerMsgId: "provider_msg_1", status: "delivered" }],
		});

		const updateStatusSpy = vi.spyOn(notificationRepo, "updateStatus");

		await processWebhook({
			provider: "resend",
			verifier,
			rawBody: VALID_BODY,
			headers: makeHeaders({}),
			secret: "secret",
			deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
		});

		// Should be called with the notification id and target status
		expect(updateStatusSpy).toHaveBeenCalledWith(notification.id, "delivered", expect.anything());
	});

	it("should call suppressionRepository.create() for hard bounce (bounced status)", async () => {
		const notification = await notificationRepo.create({
			id: "notif_bounce_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
			deliveryAddress: "bounce@example.com",
		});
		await notificationRepo.updateStatus(notification.id, "sent", {
			providerMsgId: "bounce_msg_1",
		});

		const verifier = makeMockVerifier({
			verifyResult: true,
			events: [{ providerMsgId: "bounce_msg_1", status: "bounced" }],
		});

		const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

		await processWebhook({
			provider: "resend",
			verifier,
			rawBody: VALID_BODY,
			headers: makeHeaders({}),
			secret: "secret",
			deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
		});

		expect(createSuppressionSpy).toHaveBeenCalled();
	});

	it("should call suppressionRepository.create() for spam complaint (complained status)", async () => {
		const notification = await notificationRepo.create({
			id: "notif_spam_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
			deliveryAddress: "spammer@example.com",
		});
		await notificationRepo.updateStatus(notification.id, "sent", {
			providerMsgId: "spam_msg_1",
		});

		const verifier = makeMockVerifier({
			verifyResult: true,
			events: [{ providerMsgId: "spam_msg_1", status: "complained" }],
		});

		const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

		await processWebhook({
			provider: "resend",
			verifier,
			rawBody: VALID_BODY,
			headers: makeHeaders({}),
			secret: "secret",
			deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
		});

		expect(createSuppressionSpy).toHaveBeenCalled();
	});

	it("should NOT call suppressionRepository.create() for non-suppressable status (delivered)", async () => {
		const notification = await notificationRepo.create({
			id: "notif_del_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
		});
		await notificationRepo.updateStatus(notification.id, "sent", {
			providerMsgId: "delivered_msg_1",
		});

		const verifier = makeMockVerifier({
			verifyResult: true,
			events: [{ providerMsgId: "delivered_msg_1", status: "delivered" }],
		});

		const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

		await processWebhook({
			provider: "resend",
			verifier,
			rawBody: VALID_BODY,
			headers: makeHeaders({}),
			secret: "secret",
			deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
		});

		expect(createSuppressionSpy).not.toHaveBeenCalled();
	});

	it("should handle unknown providerMsgId gracefully without crashing", async () => {
		const verifier = makeMockVerifier({
			verifyResult: true,
			events: [{ providerMsgId: "unknown_msg_999", status: "delivered" }],
		});

		const updateStatusSpy = vi.spyOn(notificationRepo, "updateStatus");

		await expect(
			processWebhook({
				provider: "resend",
				verifier,
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
			}),
		).resolves.not.toThrow();

		// No update should occur for an unknown notification
		expect(updateStatusSpy).not.toHaveBeenCalled();
	});

	it("should process multiple events in a batch independently", async () => {
		const notif1 = await notificationRepo.create({
			id: "notif_batch_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
			deliveryAddress: "user1@example.com",
		});
		await notificationRepo.updateStatus(notif1.id, "sent", { providerMsgId: "batch_msg_1" });

		const notif2 = await notificationRepo.create({
			id: "notif_batch_2",
			subscriberId: "sub_2",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
			deliveryAddress: "bad@example.com",
		});
		await notificationRepo.updateStatus(notif2.id, "sent", { providerMsgId: "batch_msg_2" });

		const verifier = makeMockVerifier({
			verifyResult: true,
			events: [
				{ providerMsgId: "batch_msg_1", status: "delivered" },
				{ providerMsgId: "batch_msg_2", status: "bounced" },
			],
		});

		const updateStatusSpy = vi.spyOn(notificationRepo, "updateStatus");
		const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

		await processWebhook({
			provider: "sendgrid",
			verifier,
			rawBody: VALID_BODY,
			headers: makeHeaders({}),
			secret: "secret",
			deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
		});

		// Both notifications should be updated
		expect(updateStatusSpy).toHaveBeenCalledTimes(2);
		// Hard bounce triggers suppression
		expect(createSuppressionSpy).toHaveBeenCalledTimes(1);
	});

	it("should skip duplicate transitions for the same notification (idempotency)", async () => {
		const notification = await notificationRepo.create({
			id: "notif_idm_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "delivered", // already delivered
		});
		await notificationRepo.updateStatus(notification.id, "delivered", {
			providerMsgId: "idm_msg_1",
		});

		const verifier = makeMockVerifier({
			verifyResult: true,
			// Trying to transition from delivered -> delivered (invalid, no-op)
			events: [{ providerMsgId: "idm_msg_1", status: "delivered" }],
		});

		const updateStatusSpy = vi.spyOn(notificationRepo, "updateStatus");

		await processWebhook({
			provider: "resend",
			verifier,
			rawBody: VALID_BODY,
			headers: makeHeaders({}),
			secret: "secret",
			deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
		});

		// No update should happen since delivered → delivered is not a valid transition
		expect(updateStatusSpy).not.toHaveBeenCalledWith(
			notification.id,
			"delivered",
			expect.anything(),
		);
	});
});
