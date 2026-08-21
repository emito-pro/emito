import type { ConsentRepository } from "@emito/core";
import { collectionResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { consentFilterSchema, subscriberIdParamSchema } from "../../schemas/admin.js";

export interface AdminConsentDeps {
	consentRepository: ConsentRepository;
}

export function registerAdminConsentEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: AdminConsentDeps,
): void {
	const { consentRepository } = deps;

	// GET /admin/consents — list consent records across all subscribers
	router.add({
		method: "GET",
		pathPattern: "/admin/consents",
		auth: "admin",
		schema: { query: consentFilterSchema },
		async handler(ctx) {
			const result = await consentRepository.listAll({
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
				subscriberId: ctx.query.subscriberId,
				category: ctx.query.category,
			});
			return collectionResponse(result.items, result.hasMore, result.cursor);
		},
	});

	// GET /admin/consents/:subscriberId — consent history for a specific subscriber
	router.add({
		method: "GET",
		pathPattern: "/admin/consents/:subscriberId",
		auth: "admin",
		schema: {
			params: subscriberIdParamSchema,
			query: consentFilterSchema,
		},
		async handler(ctx) {
			const result = await consentRepository.listConsentHistory(ctx.params.subscriberId, {
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
				category: ctx.query.category,
			});
			return collectionResponse(result.items, result.hasMore, result.cursor);
		},
	});
}
