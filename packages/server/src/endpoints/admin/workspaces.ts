import type { IntegrationRecord } from "@emito/core";
import type { Channel, WorkspaceDefault } from "@emito/types";
import { collectionResponse, jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import {
	createWorkspaceIntegrationBodySchema,
	setWorkspaceDefaultsBodySchema,
	workspaceIdParamSchema,
} from "../../schemas/admin.js";
import { getEffectiveSecretFields, maskSecrets } from "../../secrets.js";

export interface AdminWorkspaceDeps {
	integrationRepository: {
		listByWorkspace(workspaceId: string): Promise<IntegrationRecord[]>;
		create(data: {
			ownerId: string;
			channel: Channel;
			config: Record<string, unknown>;
			name?: string;
			events?: string[];
			secretFields?: string[];
		}): Promise<IntegrationRecord>;
	};
	workspaceDefaultRepository: {
		listByWorkspace(workspaceId: string): Promise<WorkspaceDefault[]>;
		upsert(data: {
			workspaceId: string;
			topicKey: string;
			channel: Channel;
			enabled: boolean;
			isMandatory?: boolean;
		}): Promise<WorkspaceDefault>;
	};
}

export function registerAdminWorkspaceEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: AdminWorkspaceDeps,
): void {
	const { integrationRepository, workspaceDefaultRepository } = deps;

	// GET /admin/workspaces/:id/integrations — any workspace's integrations (admin sees masked secrets)
	router.add({
		method: "GET",
		pathPattern: "/admin/workspaces/:id/integrations",
		auth: "admin",
		schema: { params: workspaceIdParamSchema },
		async handler(ctx) {
			const wsId = ctx.params.id;
			const integrations = await integrationRepository.listByWorkspace(wsId);
			const masked = integrations.map((i) => maskSecrets(i));
			return collectionResponse(masked, false);
		},
	});

	// POST /admin/workspaces/:id/integrations — add integration to any workspace
	router.add({
		method: "POST",
		pathPattern: "/admin/workspaces/:id/integrations",
		auth: "admin",
		schema: { params: workspaceIdParamSchema, body: createWorkspaceIntegrationBodySchema },
		async handler(ctx) {
			const secretFields = getEffectiveSecretFields(ctx.body.channel, ctx.body.secretFields);

			const wsId = ctx.params.id;
			const integration = await integrationRepository.create({
				ownerId: wsId,
				channel: ctx.body.channel,
				config: ctx.body.config,
				name: ctx.body.name,
				events: ctx.body.events,
				secretFields,
			});

			return jsonResponse(integration, 201);
		},
	});

	// GET /admin/workspaces/:id/defaults — any workspace's defaults
	router.add({
		method: "GET",
		pathPattern: "/admin/workspaces/:id/defaults",
		auth: "admin",
		schema: { params: workspaceIdParamSchema },
		async handler(ctx) {
			const wsId = ctx.params.id;
			const defaults = await workspaceDefaultRepository.listByWorkspace(wsId);
			return collectionResponse(defaults, false);
		},
	});

	// PUT /admin/workspaces/:id/defaults — set defaults for any workspace
	router.add({
		method: "PUT",
		pathPattern: "/admin/workspaces/:id/defaults",
		auth: "admin",
		schema: { params: workspaceIdParamSchema, body: setWorkspaceDefaultsBodySchema },
		async handler(ctx) {
			const wsId = ctx.params.id;
			const result = await workspaceDefaultRepository.upsert({
				workspaceId: wsId,
				topicKey: ctx.body.topicKey,
				channel: ctx.body.channel,
				enabled: ctx.body.enabled,
				isMandatory: ctx.body.isMandatory ?? false,
			});

			return jsonResponse(result);
		},
	});
}
