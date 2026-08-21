import type { NotificationRepository } from "@emito/core";
import { collectionResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { notificationFilterSchema } from "../../schemas/admin.js";

export interface AdminNotificationDeps {
	notificationRepository: NotificationRepository;
}

export function registerAdminNotificationEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: AdminNotificationDeps,
): void {
	const { notificationRepository } = deps;

	// GET /admin/notifications — cross-workspace notification log
	router.add({
		method: "GET",
		pathPattern: "/admin/notifications",
		auth: "admin",
		schema: { query: notificationFilterSchema },
		async handler(ctx) {
			const result = await notificationRepository.listCrossWorkspace({
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
				status: ctx.query.status,
				category: ctx.query.category,
				channel: ctx.query.channel,
				since: ctx.query.since ? new Date(ctx.query.since) : undefined,
				until: ctx.query.until ? new Date(ctx.query.until) : undefined,
			});
			return collectionResponse(result.items, result.hasMore, result.cursor);
		},
	});
}
