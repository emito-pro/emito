import type { InboxRecord, InboxRepository } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { collectionResponse, jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import {
	notificationIdParamsSchema,
	notificationListQuerySchema,
	snoozeBodySchema,
} from "../../schemas/subscriber.js";

function serializeInboxRecord(record: InboxRecord) {
	return {
		id: record.id,
		subscriberId: record.subscriberId,
		event: record.eventType,
		category: record.category,
		topic: record.topicKey,
		subject: record.subject,
		body: record.body,
		avatar: record.avatar,
		actionUrl: record.actionUrl,
		primaryAction:
			record.primaryActionLabel && record.primaryActionUrl
				? { label: record.primaryActionLabel, url: record.primaryActionUrl }
				: undefined,
		secondaryAction:
			record.secondaryActionLabel && record.secondaryActionUrl
				? { label: record.secondaryActionLabel, url: record.secondaryActionUrl }
				: undefined,
		data: record.data,
		readAt: record.readAt?.toISOString() ?? null,
		archivedAt: record.archivedAt?.toISOString() ?? null,
		snoozedUntil: record.snoozedUntil?.toISOString() ?? null,
		createdAt: record.createdAt.toISOString(),
	};
}

export function registerSubscriberNotificationEndpoints(
	router: ReturnType<typeof createRouter>,
	inboxRepository: InboxRepository,
): void {
	async function verifyOwnership(id: string, subscriberId: string): Promise<void> {
		const record = await inboxRepository.findById(id);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.INBOX_NOT_FOUND,
				message: `Inbox item not found: ${id}`,
			});
		}
		if (record.subscriberId !== subscriberId) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE,
				message: "Cannot modify another subscriber's notification",
			});
		}
	}

	// GET /notifications — list subscriber's inbox
	router.add({
		method: "GET",
		pathPattern: "/notifications",
		auth: "subscriber",
		schema: { query: notificationListQuerySchema },
		async handler(ctx) {
			const result = await inboxRepository.findBySubscriber(ctx.subscriberId, {
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
				status: ctx.query.status,
				category: ctx.query.category,
			});
			return collectionResponse(
				result.items.map(serializeInboxRecord),
				result.hasMore,
				result.cursor,
			);
		},
	});

	// GET /notifications/unread/count
	router.add({
		method: "GET",
		pathPattern: "/notifications/unread/count",
		auth: "subscriber",
		async handler(ctx) {
			const count = await inboxRepository.unreadCount(ctx.subscriberId);
			return jsonResponse({ count });
		},
	});

	// POST /notifications/:id/read
	router.add({
		method: "POST",
		pathPattern: "/notifications/:id/read",
		auth: "subscriber",
		schema: { params: notificationIdParamsSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			await verifyOwnership(id, ctx.subscriberId);
			await inboxRepository.updateReadAt(id);
			return jsonResponse({ success: true });
		},
	});

	// POST /notifications/:id/unread
	router.add({
		method: "POST",
		pathPattern: "/notifications/:id/unread",
		auth: "subscriber",
		schema: { params: notificationIdParamsSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			await verifyOwnership(id, ctx.subscriberId);
			await inboxRepository.clearReadAt(id);
			return jsonResponse({ success: true });
		},
	});

	// POST /notifications/:id/archive
	router.add({
		method: "POST",
		pathPattern: "/notifications/:id/archive",
		auth: "subscriber",
		schema: { params: notificationIdParamsSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			await verifyOwnership(id, ctx.subscriberId);
			await inboxRepository.updateArchivedAt(id);
			return jsonResponse({ success: true });
		},
	});

	// POST /notifications/:id/unarchive
	router.add({
		method: "POST",
		pathPattern: "/notifications/:id/unarchive",
		auth: "subscriber",
		schema: { params: notificationIdParamsSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			await verifyOwnership(id, ctx.subscriberId);
			await inboxRepository.clearArchivedAt(id);
			return jsonResponse({ success: true });
		},
	});

	// POST /notifications/:id/snooze
	router.add({
		method: "POST",
		pathPattern: "/notifications/:id/snooze",
		auth: "subscriber",
		schema: {
			params: notificationIdParamsSchema,
			body: snoozeBodySchema,
		},
		async handler(ctx) {
			const id = ctx.params.id;
			await verifyOwnership(id, ctx.subscriberId);
			await inboxRepository.updateSnoozedUntil(id, ctx.body.until);
			return jsonResponse({ success: true });
		},
	});

	// POST /notifications/read-all
	router.add({
		method: "POST",
		pathPattern: "/notifications/read-all",
		auth: "subscriber",
		async handler(ctx) {
			await inboxRepository.markAllRead(ctx.subscriberId);
			return jsonResponse({ success: true });
		},
	});
}
