import type { BroadcastScheduler, BroadcastService } from "@emito/core";
import { jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { broadcastBodySchema } from "../../schemas/admin.js";

export interface AdminBroadcastDeps {
	broadcastService: BroadcastService;
	broadcastScheduler: BroadcastScheduler;
}

export function registerAdminBroadcastEndpoint(
	router: ReturnType<typeof createRouter>,
	deps: AdminBroadcastDeps,
): void {
	const { broadcastService, broadcastScheduler } = deps;

	router.add({
		method: "POST",
		pathPattern: "/admin/broadcast",
		auth: "admin",
		schema: { body: broadcastBodySchema },
		async handler(ctx) {
			const { listSlug, event, payload, scheduledAt: scheduledAtStr } = ctx.body;
			const scheduledAt = scheduledAtStr ? new Date(scheduledAtStr) : undefined;

			if (scheduledAt && scheduledAt.getTime() > Date.now()) {
				const broadcastId = crypto.randomUUID();
				await broadcastScheduler.schedule({ listSlug, event, payload, scheduledAt }, broadcastId);
				return jsonResponse(
					{ id: broadcastId, status: "pending", scheduledAt: scheduledAt.toISOString() },
					202,
				);
			}

			const record = await broadcastService.executeBroadcast({ listSlug, event, payload });
			return jsonResponse(record);
		},
	});
}
