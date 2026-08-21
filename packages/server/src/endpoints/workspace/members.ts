import type { PreferenceRepository } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { workspaceIdParamsSchema } from "../../schemas/workspace.js";

export function registerWorkspaceMemberEndpoints(
	router: ReturnType<typeof createRouter>,
	preferenceRepository: PreferenceRepository,
): void {
	// GET /workspace/:wsId/members/preferences — overview of member preferences (admin only)
	router.add({
		method: "GET",
		pathPattern: "/workspace/:wsId/members/preferences",
		auth: "workspace",
		schema: { params: workspaceIdParamsSchema },
		async handler(ctx) {
			// This GET endpoint requires admin role (per API surface spec)
			if (ctx.workspaceRole !== "admin") {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE,
					message: "Workspace admin role required to view member preferences",
				});
			}
			const wsId = ctx.params.wsId;
			const preferences = await preferenceRepository.listByWorkspace(wsId);
			return jsonResponse({ preferences });
		},
	});
}
