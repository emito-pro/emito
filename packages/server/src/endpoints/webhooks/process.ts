import type { NotificationRepository, SuppressionRepository } from "@emito/core";
import { addSuppression, canTransition, transitionStatus } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError, SUPPRESSABLE_ERROR_CODES } from "@emito/types";
import type { Logger } from "@emito/types";
import type { WebhookEvent, WebhookVerifier } from "./types.js";

/** Maps DeliveryStatus values from webhooks to their corresponding EmitoErrorCode for suppression checks.
 * Only address-level permanent errors trigger suppression (architecture docs: "Non-address errors
 * (config problems, content rejection) fail the notification but never suppress the recipient.") */
const STATUS_TO_ERROR_CODE: Record<string, string> = {
	bounced: "DELIVERY_HARD_BOUNCE",
	complained: "DELIVERY_SPAM_COMPLAINT",
};

export interface ProcessWebhookDeps {
	notificationRepository: NotificationRepository;
	suppressionRepository: SuppressionRepository;
}

export interface ProcessWebhookParams {
	provider: string;
	verifier: WebhookVerifier;
	rawBody: string;
	headers: Headers;
	secret: string;
	deps: ProcessWebhookDeps;
	logger?: Logger;
}

export async function processWebhook(params: ProcessWebhookParams): Promise<void> {
	const { provider, verifier, rawBody, headers, secret, deps, logger } = params;

	// Verify signature BEFORE parsing payload (security.md)
	const valid = verifier.verify(rawBody, headers, secret);
	if (!valid) {
		logger?.warn(
			{ provider, errorCode: EMITO_ERROR_CODE.WEBHOOK_SIGNATURE_INVALID },
			"webhook signature invalid",
		);
		throw new EmitoError({
			code: EMITO_ERROR_CODE.WEBHOOK_SIGNATURE_INVALID,
			message: `Invalid webhook signature from ${provider}`,
			context: { provider },
		});
	}

	// Parse payload
	let payload: unknown;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		logger?.warn(
			{ provider, errorCode: EMITO_ERROR_CODE.WEBHOOK_PARSE_FAILED },
			"webhook parse failed",
		);
		throw new EmitoError({
			code: EMITO_ERROR_CODE.WEBHOOK_PARSE_FAILED,
			message: `Failed to parse webhook payload from ${provider}`,
			context: { provider },
		});
	}

	// Normalize to standard events
	const events = verifier.normalize(payload);

	// Process each event independently (SendGrid sends batched arrays)
	for (const event of events) {
		await processEvent(event, provider, deps);
	}
}

async function processEvent(
	event: WebhookEvent,
	provider: string,
	deps: ProcessWebhookDeps,
): Promise<void> {
	if (!event.providerMsgId) {
		// No providerMsgId — acknowledge but skip (risk assessment: providerMsgId not set)
		return;
	}

	const notification = await deps.notificationRepository.findByProviderMsgId(event.providerMsgId);
	if (!notification) {
		// Unknown notification — acknowledge to prevent retry
		return;
	}

	// Check if transition is valid (idempotency — canTransition prevents duplicate updates)
	if (!canTransition(notification.status, event.status)) {
		return;
	}

	// Transition status
	await transitionStatus(deps.notificationRepository, {
		notificationId: notification.id,
		from: notification.status,
		to: event.status,
		provider,
		providerMsgId: event.providerMsgId,
	});

	// Auto-suppression for hard bounce / spam complaint
	const errorCode = STATUS_TO_ERROR_CODE[event.status];
	if (
		errorCode &&
		SUPPRESSABLE_ERROR_CODES.has(errorCode as Parameters<typeof SUPPRESSABLE_ERROR_CODES.has>[0])
	) {
		// Determine address from the notification record
		const address = getNotificationAddress(notification);
		if (address) {
			await addSuppression(deps.suppressionRepository, {
				address,
				channel: notification.channel,
				reason: event.status,
				provider,
				providerMsgId: event.providerMsgId,
			});
		}
	}
}

function getNotificationAddress(notification: {
	deliveryAddress?: string;
}): string | undefined {
	return notification.deliveryAddress ?? undefined;
}
