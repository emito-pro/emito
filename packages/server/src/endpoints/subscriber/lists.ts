import type { MembershipService } from "@emito/core";
import { collectionResponse, jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { cursorQuerySchema, slugParamSchema } from "../../schemas/admin.js";

export interface SubscriberListDeps {
	membershipService: MembershipService;
}

export function registerSubscriberListEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: SubscriberListDeps,
): void {
	const { membershipService } = deps;

	// POST /lists/:slug/subscribe — subscribe to list
	router.add({
		method: "POST",
		pathPattern: "/lists/:slug/subscribe",
		auth: "subscriber",
		schema: { params: slugParamSchema },
		async handler(ctx) {
			const { member } = await membershipService.subscribe(ctx.subscriberId, ctx.params.slug);
			return jsonResponse(member);
		},
	});

	// POST /lists/:slug/unsubscribe — unsubscribe from list
	router.add({
		method: "POST",
		pathPattern: "/lists/:slug/unsubscribe",
		auth: "subscriber",
		schema: { params: slugParamSchema },
		async handler(ctx) {
			const member = await membershipService.unsubscribe(ctx.subscriberId, ctx.params.slug);
			return jsonResponse(member);
		},
	});

	// GET /subscriptions — list subscriber's own list memberships
	router.add({
		method: "GET",
		pathPattern: "/subscriptions",
		auth: "subscriber",
		schema: { query: cursorQuerySchema },
		async handler(ctx) {
			const result = await membershipService.listSubscriptions(ctx.subscriberId, {
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
			});
			return collectionResponse(result.items, result.hasMore, result.cursor);
		},
	});
}
