import type { WorkspaceDefaultRepository } from "@emito/core";
import { jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { workspaceDefaultsBodySchema, workspaceIdParamsSchema } from "../../schemas/workspace.js";

export function registerWorkspaceDefaultEndpoints(
	router: ReturnType<typeof createRouter>,
	workspaceDefaultRepository: WorkspaceDefaultRepository,
): void {
	// GET /workspace/:wsId/defaults — workspace notification defaults (any member)
	router.add({
		method: "GET",
		pathPattern: "/workspace/:wsId/defaults",
		auth: "workspace",
		schema: { params: workspaceIdParamsSchema },
		async handler(ctx) {
			const defaults = await workspaceDefaultRepository.listByWorkspace(ctx.params.wsId);
			return jsonResponse({ defaults });
		},
	});

	// PUT /workspace/:wsId/defaults — set workspace defaults (admin only via workspace auth)
	router.add({
		method: "PUT",
		pathPattern: "/workspace/:wsId/defaults",
		auth: "workspace",
		schema: {
			params: workspaceIdParamsSchema,
			body: workspaceDefaultsBodySchema,
		},
		async handler(ctx) {
			const result = await workspaceDefaultRepository.upsert({
				workspaceId: ctx.params.wsId,
				topicKey: ctx.body.topicKey,
				channel: ctx.body.channel,
				enabled: ctx.body.enabled,
				isMandatory: ctx.body.isMandatory,
			});
			return jsonResponse(result);
		},
	});
}
