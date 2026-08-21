import { type DeliveryStatus, EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { NotificationRepository } from "../repositories/notification-repository";
import type { UpdateNotificationStatusData } from "../repositories/types";

const VALID_TRANSITIONS: ReadonlyMap<DeliveryStatus, ReadonlySet<DeliveryStatus>> = new Map([
	[
		"pending",
		new Set<DeliveryStatus>([
			"sent",
			"failed",
			"suppressed",
			"blocked_by_preference",
			"blocked_by_consent",
			"blocked_by_admin",
			"digested",
		]),
	],
	["sent", new Set<DeliveryStatus>(["delivered", "deferred", "bounced", "failed", "complained"])],
	[
		"delivered",
		new Set<DeliveryStatus>([
			"opened",
			"machine_opened",
			"clicked",
			"complained",
			"unsubscribed",
			"read",
		]),
	],
	["deferred", new Set<DeliveryStatus>(["sent", "delivered", "bounced", "failed"])],
	["bounced", new Set<DeliveryStatus>()],
	["failed", new Set<DeliveryStatus>()],
	["suppressed", new Set<DeliveryStatus>()],
	["complained", new Set<DeliveryStatus>(["unsubscribed"])],
	["opened", new Set<DeliveryStatus>(["clicked", "unsubscribed", "complained"])],
	["machine_opened", new Set<DeliveryStatus>(["opened", "clicked", "unsubscribed", "complained"])],
	["clicked", new Set<DeliveryStatus>(["unsubscribed", "complained"])],
	["unsubscribed", new Set<DeliveryStatus>()],
	["read", new Set<DeliveryStatus>()],
	["digested", new Set<DeliveryStatus>(["pending", "sent", "failed"])],
	["blocked_by_preference", new Set<DeliveryStatus>()],
	["blocked_by_consent", new Set<DeliveryStatus>()],
	["blocked_by_admin", new Set<DeliveryStatus>()],
]);

export function isDeliveryStatus(s: string): s is DeliveryStatus {
	return VALID_TRANSITIONS.has(s as DeliveryStatus);
}

export function canTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
	const allowed = VALID_TRANSITIONS.get(from);
	return allowed?.has(to) ?? false;
}

export function transition(from: DeliveryStatus, to: DeliveryStatus): DeliveryStatus {
	if (!canTransition(from, to)) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.DELIVERY_FAILED,
			message: `Invalid status transition: ${from} -> ${to}`,
			isRetryable: false,
			context: { fromStatus: from, toStatus: to },
		});
	}
	return to;
}

export function getValidTransitions(status: DeliveryStatus): DeliveryStatus[] {
	const allowed = VALID_TRANSITIONS.get(status);
	return allowed ? [...allowed] : [];
}

export interface StatusTransitionParams {
	notificationId: string;
	from: DeliveryStatus;
	to: DeliveryStatus;
	provider?: string;
	providerMsgId?: string;
	errorMessage?: string;
	errorClassification?: "permanent" | "transient" | "rate_limited";
}

export async function transitionStatus(
	repository: NotificationRepository,
	params: StatusTransitionParams,
): Promise<void> {
	transition(params.from, params.to);

	const metadata: UpdateNotificationStatusData = {};

	if (params.provider) metadata.provider = params.provider;
	if (params.providerMsgId) metadata.providerMsgId = params.providerMsgId;
	if (params.errorMessage) metadata.errorMessage = params.errorMessage;
	if (params.errorClassification) metadata.errorClassification = params.errorClassification;

	switch (params.to) {
		case "sent":
			metadata.sentAt = new Date();
			break;
		case "delivered":
			metadata.deliveredAt = new Date();
			break;
		case "failed":
		case "bounced":
			metadata.failedAt = new Date();
			break;
		case "opened":
		case "machine_opened":
			metadata.openedAt = new Date();
			break;
		case "clicked":
			metadata.clickedAt = new Date();
			break;
		default:
			break;
	}

	await repository.updateStatus(params.notificationId, params.to, metadata);
}
