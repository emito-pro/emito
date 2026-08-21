import type { IntegrationRepository } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { requireOwnership } from "../../auth/ownership.js";
import { collectionResponse, jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import {
	integrationCreateBodySchema,
	integrationIdParamsSchema,
	integrationUpdateBodySchema,
} from "../../schemas/subscriber.js";

export function registerSubscriberIntegrationEndpoints(
	router: ReturnType<typeof createRouter>,
	integrationRepository: IntegrationRepository,
): void {
	// GET /integrations — list subscriber's personal integrations
	router.add({
		method: "GET",
		pathPattern: "/integrations",
		auth: "subscriber",
		async handler(ctx) {
			const integrations = await integrationRepository.listBySubscriber(ctx.subscriberId);
			return collectionResponse(integrations, false);
		},
	});

	// POST /integrations — add personal integration
	router.add({
		method: "POST",
		pathPattern: "/integrations",
		auth: "subscriber",
		schema: { body: integrationCreateBodySchema },
		async handler(ctx) {
			const integration = await integrationRepository.create({
				ownerId: ctx.subscriberId,
				subscriberId: ctx.subscriberId,
				channel: ctx.body.channel,
				name: ctx.body.name,
				events: ctx.body.events,
				config: ctx.body.config,
			});
			return jsonResponse(integration, 201);
		},
	});

	// PUT /integrations/:id — update personal integration
	router.add({
		method: "PUT",
		pathPattern: "/integrations/:id",
		auth: "subscriber",
		schema: {
			params: integrationIdParamsSchema,
			body: integrationUpdateBodySchema,
		},
		async handler(ctx) {
			const id = ctx.params.id;
			await requireOwnership(
				integrationRepository,
				id,
				ctx.subscriberId,
				EMITO_ERROR_CODE.INTEGRATION_NOT_FOUND,
			);
			const integration = await integrationRepository.update(id, ctx.body);
			return jsonResponse(integration);
		},
	});

	// POST /integrations/:id/deactivate — deactivate personal integration
	router.add({
		method: "POST",
		pathPattern: "/integrations/:id/deactivate",
		auth: "subscriber",
		schema: { params: integrationIdParamsSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			await requireOwnership(
				integrationRepository,
				id,
				ctx.subscriberId,
				EMITO_ERROR_CODE.INTEGRATION_NOT_FOUND,
			);
			await integrationRepository.deactivate(id);
			return jsonResponse({ success: true });
		},
	});
}
