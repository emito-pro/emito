/**
 * Regression tests: getNotificationAddress must not fall back to subscriberId.
 *
 * Behavior under test:
 *   When a notification is bounced and the record has no `metadata.to` or
 *   `metadata.email`, `getNotificationAddress` must NOT return
 *   `notification.subscriberId` as a fallback address. Doing so creates a
 *   suppression entry keyed by the subscriberId (e.g. "sub_bounce_1") rather
 *   than the real delivery address. The pre-send suppression check uses the
 *   subscriber's actual email, so a subscriberId-keyed entry never matches and
 *   the subscriber keeps receiving mail.
 *
 * Expected contract:
 *   - `NotificationRecord` and `CreateNotificationData` carry `deliveryAddress?: string`
 *   - `deliveryAddress` is populated from `deliveryParams.to` in send.ts
 *   - `getNotificationAddress` reads `notification.deliveryAddress` only, returns
 *     `undefined` if absent — never falls back to `subscriberId`
 *   - Suppression creation is skipped when address is `undefined`
 *
 * Cases:
 *   (1) Happy path: notification with deliveryAddress set → bounce → suppression entry
 *       has the real email address, not subscriberId.
 *   (2) Defensive: notification without deliveryAddress → bounce → no suppression created.
 *   (3) Regression: subscriberId is never used as suppression address.
 */

import { InMemoryNotificationRepository, InMemorySuppressionRepository } from "@emito/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processWebhook } from "../../endpoints/webhooks/process.js";
import type { WebhookEvent, WebhookVerifier } from "../../endpoints/webhooks/types.js";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeMockVerifier(events: WebhookEvent[]): WebhookVerifier {
	return {
		verify: vi.fn().mockReturnValue(true),
		normalize: vi.fn().mockReturnValue(events),
	};
}

function makeHeaders(record: Record<string, string>): Headers {
	return new Headers(record);
}

const VALID_BODY = '{"test":true}';

// ----------------------------------------------------------------
// Regression tests — B-014
// ----------------------------------------------------------------

describe("getNotificationAddress() — suppression address resolution", () => {
	let notificationRepo: InMemoryNotificationRepository;
	let suppressionRepo: InMemorySuppressionRepository;

	beforeEach(() => {
		notificationRepo = new InMemoryNotificationRepository();
		suppressionRepo = new InMemorySuppressionRepository();
	});

	describe("happy path — deliveryAddress field is the primary address source", () => {
		it("should create a suppression entry keyed by deliveryAddress when deliveryAddress is set on the notification", async () => {
			// A notification correctly populated with deliveryAddress (the fix)
			const notification = await notificationRepo.create({
				id: "notif_happy_1",
				subscriberId: "sub_happy_1",
				eventType: "order.confirm",
				category: "transactional",
				channel: "email",
				status: "sent",
				deliveryAddress: "alice@example.com",
			});
			await notificationRepo.updateStatus(notification.id, "sent", {
				providerMsgId: "happy_msg_1",
			});

			const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

			await processWebhook({
				provider: "resend",
				verifier: makeMockVerifier([{ providerMsgId: "happy_msg_1", status: "bounced" }]),
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
			});

			expect(createSuppressionSpy).toHaveBeenCalledOnce();
			expect(createSuppressionSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					address: "alice@example.com",
					channel: "email",
				}),
			);
		});

		it("should NOT create a suppression entry keyed by subscriberId (bug regression)", async () => {
			// A notification correctly populated with deliveryAddress — bounce must not
			// create an entry keyed by the subscriberId string.
			const notification = await notificationRepo.create({
				id: "notif_b014_reg_1",
				subscriberId: "sub_b014_reg_1",
				eventType: "order.confirm",
				category: "transactional",
				channel: "email",
				status: "sent",
				deliveryAddress: "carol@example.com",
			});
			await notificationRepo.updateStatus(notification.id, "sent", {
				providerMsgId: "b014_msg_reg_1",
			});

			const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

			await processWebhook({
				provider: "resend",
				verifier: makeMockVerifier([{ providerMsgId: "b014_msg_reg_1", status: "bounced" }]),
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
			});

			// The suppression entry must not use the subscriberId as the address
			expect(createSuppressionSpy).not.toHaveBeenCalledWith(
				expect.objectContaining({
					address: "sub_b014_reg_1",
				}),
			);
			// The correct address must be used
			expect(createSuppressionSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					address: "carol@example.com",
				}),
			);
		});
	});

	describe("defensive path — no address → no suppression", () => {
		it("should NOT create a suppression entry when notification has no deliveryAddress and no metadata.to", async () => {
			// A notification without deliveryAddress or metadata address — the bug would
			// have created a suppression keyed by subscriberId; the fix must skip creation.
			const notification = await notificationRepo.create({
				id: "notif_no_addr_1",
				subscriberId: "sub_no_addr_1",
				eventType: "order.confirm",
				category: "transactional",
				channel: "email",
				status: "sent",
				// No deliveryAddress, no metadata.to / metadata.email
			});
			await notificationRepo.updateStatus(notification.id, "sent", {
				providerMsgId: "no_addr_msg_1",
			});

			const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

			await processWebhook({
				provider: "resend",
				verifier: makeMockVerifier([{ providerMsgId: "no_addr_msg_1", status: "bounced" }]),
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
			});

			// No suppression must be created — a no-op is always better than a bad entry
			expect(createSuppressionSpy).not.toHaveBeenCalled();
		});

		it("should NOT create a suppression entry keyed by subscriberId when no real address is available", async () => {
			// Explicit proof that the subscriberId fallback is removed
			const subscriberId = "sub_fallback_guard_1";
			const notification = await notificationRepo.create({
				id: "notif_fallback_guard_1",
				subscriberId,
				eventType: "marketing.newsletter",
				category: "marketing",
				channel: "email",
				status: "sent",
				// Intentionally no deliveryAddress, no metadata address
			});
			await notificationRepo.updateStatus(notification.id, "sent", {
				providerMsgId: "fallback_guard_msg_1",
			});

			const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

			await processWebhook({
				provider: "sendgrid",
				verifier: makeMockVerifier([{ providerMsgId: "fallback_guard_msg_1", status: "bounced" }]),
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
			});

			// Must not create any suppression at all
			expect(createSuppressionSpy).not.toHaveBeenCalled();
		});
	});

	describe("spam complaint — same address resolution rules apply", () => {
		it("should create a suppression entry with deliveryAddress for spam complaint", async () => {
			const notification = await notificationRepo.create({
				id: "notif_spam_b014_1",
				subscriberId: "sub_spam_b014_1",
				eventType: "marketing.promo",
				category: "marketing",
				channel: "email",
				status: "sent",
				deliveryAddress: "complainer@example.com",
			});
			await notificationRepo.updateStatus(notification.id, "sent", {
				providerMsgId: "spam_b014_msg_1",
			});

			const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

			await processWebhook({
				provider: "sendgrid",
				verifier: makeMockVerifier([{ providerMsgId: "spam_b014_msg_1", status: "complained" }]),
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
			});

			expect(createSuppressionSpy).toHaveBeenCalledOnce();
			expect(createSuppressionSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					address: "complainer@example.com",
					channel: "email",
					reason: "complained",
				}),
			);
		});

		it("should NOT create a suppression entry when notification has no deliveryAddress and spam complaint arrives", async () => {
			const notification = await notificationRepo.create({
				id: "notif_spam_noaddr_1",
				subscriberId: "sub_spam_noaddr_1",
				eventType: "marketing.promo",
				category: "marketing",
				channel: "email",
				status: "sent",
				// No deliveryAddress, no metadata address
			});
			await notificationRepo.updateStatus(notification.id, "sent", {
				providerMsgId: "spam_noaddr_msg_1",
			});

			const createSuppressionSpy = vi.spyOn(suppressionRepo, "create");

			await processWebhook({
				provider: "sendgrid",
				verifier: makeMockVerifier([{ providerMsgId: "spam_noaddr_msg_1", status: "complained" }]),
				rawBody: VALID_BODY,
				headers: makeHeaders({}),
				secret: "secret",
				deps: { notificationRepository: notificationRepo, suppressionRepository: suppressionRepo },
			});

			expect(createSuppressionSpy).not.toHaveBeenCalled();
		});
	});
});

// ----------------------------------------------------------------
// NotificationRecord.deliveryAddress — type-level contract tests
// ----------------------------------------------------------------

describe("NotificationRecord — deliveryAddress field", () => {
	let notificationRepo: InMemoryNotificationRepository;

	beforeEach(() => {
		notificationRepo = new InMemoryNotificationRepository();
	});

	it("should store and return deliveryAddress when set during create", async () => {
		const record = await notificationRepo.create({
			id: "notif_da_1",
			subscriberId: "sub_da_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			deliveryAddress: "stored@example.com",
		});

		expect(record.deliveryAddress).toBe("stored@example.com");
	});

	it("should return undefined deliveryAddress when not set during create", async () => {
		const record = await notificationRepo.create({
			id: "notif_da_undef_1",
			subscriberId: "sub_da_undef_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
		});

		expect(record.deliveryAddress).toBeUndefined();
	});

	it("should return deliveryAddress via findByProviderMsgId", async () => {
		const created = await notificationRepo.create({
			id: "notif_da_find_1",
			subscriberId: "sub_da_find_1",
			eventType: "order.confirm",
			category: "transactional",
			channel: "email",
			deliveryAddress: "findme@example.com",
		});
		await notificationRepo.updateStatus(created.id, "sent", {
			providerMsgId: "da_find_msg_1",
		});

		const found = await notificationRepo.findByProviderMsgId("da_find_msg_1");

		expect(found).not.toBeNull();
		expect(found?.deliveryAddress).toBe("findme@example.com");
	});
});
