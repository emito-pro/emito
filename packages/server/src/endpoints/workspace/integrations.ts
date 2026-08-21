import type { IntegrationRepository } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { requireOwnership } from "../../auth/ownership.js";
import { jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import {
	workspaceIdParamsSchema,
	workspaceIntegrationCreateBodySchema,
	workspaceIntegrationIdParamsSchema,
	workspaceIntegrationUpdateBodySchema,
} from "../../schemas/workspace.js";
import { getEffectiveSecretFields, maskSecrets, stripConfig } from "../../secrets.js";

export function registerWorkspaceIntegrationEndpoints(
	router: ReturnType<typeof createRouter>,
	integrationRepository: IntegrationRepository,
): void {
	// GET /workspace/:wsId/integrations — workspace-wide integrations (any member)
	router.add({
		method: "GET",
		pathPattern: "/workspace/:wsId/integrations",
		auth: "workspace",
		schema: { params: workspaceIdParamsSchema },
		async handler(ctx) {
			const integrations = await integrationRepository.listByWorkspace(ctx.params.wsId);
			const isAdmin = ctx.workspaceRole === "admin";
			const result = integrations.map((integration) => {
				if (isAdmin) {
					return maskSecrets(integration);
				}
				return stripConfig(integration);
			});
			return jsonResponse({ integrations: result });
		},
	});

	// POST /workspace/:wsId/integrations — add workspace integration (admin only)
	router.add({
		method: "POST",
		pathPattern: "/workspace/:wsId/integrations",
		auth: "workspace",
		schema: {
			params: workspaceIdParamsSchema,
			body: workspaceIntegrationCreateBodySchema,
		},
		async handler(ctx) {
			const secretFields = getEffectiveSecretFields(ctx.body.channel, ctx.body.secretFields);
			const integration = await integrationRepository.create({
				ownerId: ctx.params.wsId,
				channel: ctx.body.channel,
				name: ctx.body.name,
				events: ctx.body.events,
				config: ctx.body.config,
				secretFields,
			});
			return jsonResponse(integration, 201);
		},
	});

	// PUT /workspace/:wsId/integrations/:id — update workspace integration (admin only)
	router.add({
		method: "PUT",
		pathPattern: "/workspace/:wsId/integrations/:id",
		auth: "workspace",
		schema: {
			params: workspaceIntegrationIdParamsSchema,
			body: workspaceIntegrationUpdateBodySchema,
		},
		async handler(ctx) {
			const id = ctx.params.id;
			await requireOwnership(
				integrationRepository,
				id,
				ctx.params.wsId,
				EMITO_ERROR_CODE.INTEGRATION_NOT_FOUND,
			);
			const integration = await integrationRepository.update(id, ctx.body);
			return jsonResponse(integration);
		},
	});

	// POST /workspace/:wsId/integrations/:id/deactivate — deactivate workspace integration (admin only)
	router.add({
		method: "POST",
		pathPattern: "/workspace/:wsId/integrations/:id/deactivate",
		auth: "workspace",
		schema: { params: workspaceIntegrationIdParamsSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			await requireOwnership(
				integrationRepository,
				id,
				ctx.params.wsId,
				EMITO_ERROR_CODE.INTEGRATION_NOT_FOUND,
			);
			await integrationRepository.deactivate(id);
			return jsonResponse({ success: true });
		},
	});
}
