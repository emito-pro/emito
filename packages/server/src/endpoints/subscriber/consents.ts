import type { ConsentRepository } from "@emito/core";
import { collectionResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { cursorQuerySchema } from "../../schemas/admin.js";

export function registerSubscriberConsentEndpoints(
	router: ReturnType<typeof createRouter>,
	consentRepository: ConsentRepository,
): void {
	// GET /consents — authenticated subscriber's own consent history
	router.add({
		method: "GET",
		pathPattern: "/consents",
		auth: "subscriber",
		schema: { query: cursorQuerySchema },
		async handler(ctx) {
			const result = await consentRepository.listConsentHistory(ctx.subscriberId, {
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
			});
			return collectionResponse(result.items, result.hasMore, result.cursor);
		},
	});
}
