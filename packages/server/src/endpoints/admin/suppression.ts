import type { SuppressionRepository } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { collectionResponse, jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import {
	createSuppressionBodySchema,
	idParamSchema,
	suppressionFilterSchema,
} from "../../schemas/admin.js";

export interface AdminSuppressionDeps {
	suppressionRepository: SuppressionRepository;
}

export function registerAdminSuppressionEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: AdminSuppressionDeps,
): void {
	const { suppressionRepository } = deps;

	// GET /admin/suppression — list suppressed addresses
	router.add({
		method: "GET",
		pathPattern: "/admin/suppression",
		auth: "admin",
		schema: { query: suppressionFilterSchema },
		async handler(ctx) {
			const result = await suppressionRepository.list({
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
				channel: ctx.query.channel,
				includeArchived: ctx.query.includeArchived,
			});
			return collectionResponse(result.items, result.hasMore, result.cursor);
		},
	});

	// POST /admin/suppression — manually suppress address
	router.add({
		method: "POST",
		pathPattern: "/admin/suppression",
		auth: "admin",
		schema: { body: createSuppressionBodySchema },
		async handler(ctx) {
			const record = await suppressionRepository.create(ctx.body);
			return jsonResponse(record, 201);
		},
	});

	// POST /admin/suppression/:id/archive — lift suppression (003e pattern)
	router.add({
		method: "POST",
		pathPattern: "/admin/suppression/:id/archive",
		auth: "admin",
		schema: { params: idParamSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			const record = await suppressionRepository.findById(id);
			if (!record) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.SUPPRESSION_NOT_FOUND,
					message: `Suppression record ${id} not found`,
				});
			}

			if (record.archivedAt) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
					message: `Suppression record ${id} is already archived`,
				});
			}

			const archived = await suppressionRepository.archive(record.address, record.channel);
			if (!archived) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.SUPPRESSION_NOT_FOUND,
					message: `Active suppression for record ${id} not found`,
				});
			}

			return jsonResponse({ id, archived: true });
		},
	});
}
