import type { SubscriberRepository } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { collectionResponse, jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import {
	createSubscriberBodySchema,
	cursorQuerySchema,
	idParamSchema,
} from "../../schemas/admin.js";

export interface AdminSubscriberDeps {
	subscriberRepository: SubscriberRepository;
}

export function registerAdminSubscriberEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: AdminSubscriberDeps,
): void {
	const { subscriberRepository } = deps;

	// GET /admin/subscribers — list all subscribers
	router.add({
		method: "GET",
		pathPattern: "/admin/subscribers",
		auth: "admin",
		schema: { query: cursorQuerySchema },
		async handler(ctx) {
			const result = await subscriberRepository.list({
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
			});
			return collectionResponse(result.items, result.hasMore, result.cursor);
		},
	});

	// GET /admin/subscribers/:id — get subscriber details
	router.add({
		method: "GET",
		pathPattern: "/admin/subscribers/:id",
		auth: "admin",
		schema: { params: idParamSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			const subscriber = await subscriberRepository.findById(id);
			if (!subscriber) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND,
					message: `Subscriber ${id} not found`,
				});
			}
			return jsonResponse(subscriber);
		},
	});

	// POST /admin/subscribers — create/upsert subscriber
	router.add({
		method: "POST",
		pathPattern: "/admin/subscribers",
		auth: "admin",
		schema: { body: createSubscriberBodySchema },
		async handler(ctx) {
			const existing = await subscriberRepository.findById(ctx.body.id);
			if (existing) {
				const updated = await subscriberRepository.update(ctx.body.id, {
					email: ctx.body.email,
					phone: ctx.body.phone,
					lang: ctx.body.lang,
					locale: ctx.body.locale,
					timezone: ctx.body.timezone,
					metadata: ctx.body.metadata,
				});
				return jsonResponse(updated);
			}

			const subscriber = await subscriberRepository.create(ctx.body);
			return jsonResponse(subscriber, 201);
		},
	});

	// POST /admin/subscribers/:id/erase — GDPR data erasure
	router.add({
		method: "POST",
		pathPattern: "/admin/subscribers/:id/erase",
		auth: "admin",
		schema: { params: idParamSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			const subscriber = await subscriberRepository.findById(id);
			if (!subscriber) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND,
					message: `Subscriber ${id} not found`,
				});
			}
			await subscriberRepository.erase(id);
			return jsonResponse({ id, erased: true });
		},
	});
}
