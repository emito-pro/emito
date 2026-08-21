import type { ListRepository } from "@emito/core";
import { collectionResponse, jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import {
	createListBodySchema,
	idParamSchema,
	listFilterSchema,
	updateListBodySchema,
} from "../../schemas/admin.js";

export interface AdminListDeps {
	listRepository: ListRepository;
}

export function registerAdminListEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: AdminListDeps,
): void {
	const { listRepository } = deps;

	// GET /admin/lists — list all mailing lists
	router.add({
		method: "GET",
		pathPattern: "/admin/lists",
		auth: "admin",
		schema: { query: listFilterSchema },
		async handler(ctx) {
			const result = await listRepository.list({
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
				archived: ctx.query.archived,
			});
			return collectionResponse(result.items, result.hasMore, result.cursor);
		},
	});

	// POST /admin/lists — create list
	router.add({
		method: "POST",
		pathPattern: "/admin/lists",
		auth: "admin",
		schema: { body: createListBodySchema },
		async handler(ctx) {
			const list = await listRepository.create({
				name: ctx.body.name,
				slug: ctx.body.slug,
				description: ctx.body.description,
				optinType: ctx.body.optinType,
				visibility: ctx.body.visibility,
				categoryId: ctx.body.categoryId,
			});
			return jsonResponse(list, 201);
		},
	});

	// PUT /admin/lists/:id — update list
	router.add({
		method: "PUT",
		pathPattern: "/admin/lists/:id",
		auth: "admin",
		schema: {
			params: idParamSchema,
			body: updateListBodySchema,
		},
		async handler(ctx) {
			const list = await listRepository.update(ctx.params.id, ctx.body);
			return jsonResponse(list);
		},
	});

	// POST /admin/lists/:id/archive — archive (soft-delete) list
	router.add({
		method: "POST",
		pathPattern: "/admin/lists/:id/archive",
		auth: "admin",
		schema: { params: idParamSchema },
		async handler(ctx) {
			const list = await listRepository.archive(ctx.params.id);
			return jsonResponse(list);
		},
	});
}
