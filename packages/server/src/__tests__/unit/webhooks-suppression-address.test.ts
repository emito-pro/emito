/**
 * Regression tests for B-014: getNotificationAddress must never fall back to subscriberId.
 *
 * Tests:
 * - Old behavior: notification without deliveryAddress or metadata.to → subscriberId used (wrong)
 * - New behavior: notification with deliveryAddress → real address used for suppression
 * - Defensive: notification without any address → suppression skipped entirely
 *
 * Rules applied:
 * - Rule 1: Assert on EmitoErrorCode values, not message strings
 * - Rule 12: Use in-memory repository stubs for unit tests
 * - Rule 15: describe/it naming convention
 * - Rule 28: Assert on call arguments for mock function verifications
 */

import { InMemoryNotificationRepository, InMemorySuppressionRepository } from "@emito/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processWebhook } from "../../endpoints/webhooks/process.js";
import type { WebhookEvent, WebhookVerifier } from "../../endpoints/webhooks/types.js";

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

describe("B-014: suppression address resolution", () => {
	let notificationRepo: InMemoryNotificationRepository;
	let suppressionRepo: InMemorySuppressionRepository;

	beforeEach(() => {
		notificationRepo = new InMemoryNotificationRepository();
		suppressionRepo = new InMemorySuppressionRepository();
	});

	it("should use deliveryAddress for suppression when present on the notification record", async () => {
		const notification = await notificationRepo.create({
			id: "notif_addr_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
			deliveryAddress: "real@example.com",
		});
		await notificationRepo.updateStatus(notification.id, "sent", {
			providerMsgId: "addr_msg_1",
		});

		const verifier = makeMockVerifier({
			verifyResult: true,
			events: [{ providerMsgId: "addr_msg_1", status: "bounced" }],
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

		expect(createSuppressionSpy).toHaveBeenCalledWith(
			expect.objectContaining({ address: "real@example.com" }),
		);
	});

	it("should skip suppression when no real address is available (never use subscriberId)", async () => {
		// Create a notification with NO deliveryAddress and NO metadata.to/email
		// Before the fix, this would fall back to subscriberId "sub_1" — creating a bad suppression entry
		const notification = await notificationRepo.create({
			id: "notif_no_addr_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
		});
		await notificationRepo.updateStatus(notification.id, "sent", {
			providerMsgId: "no_addr_msg_1",
		});

		const verifier = makeMockVerifier({
			verifyResult: true,
			events: [{ providerMsgId: "no_addr_msg_1", status: "bounced" }],
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

		// Suppression must NOT be created — no real address available
		expect(createSuppressionSpy).not.toHaveBeenCalled();
	});

	it("should never create a suppression entry keyed by subscriberId", async () => {
		// This test documents the B-014 bug: without the fix, a bounce on a notification
		// without metadata.to would suppress "sub_1" — matching no real pre-send check
		const notification = await notificationRepo.create({
			id: "notif_bug_1",
			subscriberId: "sub_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			status: "sent",
		});
		await notificationRepo.updateStatus(notification.id, "sent", {
			providerMsgId: "bug_msg_1",
		});

		const verifier = makeMockVerifier({
			verifyResult: true,
			events: [{ providerMsgId: "bug_msg_1", status: "complained" }],
		});

		await processWebhook({
			provider: "resend",
			verifier,
			rawBody: VALID_BODY,
			headers: makeHeaders({}),
			secret: "secret",
			deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
		});

		// Verify no suppression entry exists with subscriberId as the address
		const result = await suppressionRepo.findByAddressAndChannel("sub_1", "email");
		expect(result).toBeNull();
	});
});
