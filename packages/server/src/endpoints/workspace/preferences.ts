import type { PreferenceRepository } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ResolveWorkspaceRole } from "../../auth/workspace-role.js";
import { requireMembership } from "../../auth/workspace-role.js";
import { jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { workspaceIdParamsSchema, workspacePreferenceBodySchema } from "../../schemas/workspace.js";

export function registerWorkspacePreferenceEndpoints(
	router: ReturnType<typeof createRouter>,
	preferenceRepository: PreferenceRepository,
	resolveWorkspaceRole?: ResolveWorkspaceRole,
): void {
	function ensureResolveWorkspaceRole(): ResolveWorkspaceRole {
		if (!resolveWorkspaceRole) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.CONFIG_INVALID,
				message: "resolveWorkspaceRole not configured",
			});
		}
		return resolveWorkspaceRole;
	}

	// GET /workspace/:wsId/preferences — subscriber's own preferences in this workspace
	router.add({
		method: "GET",
		pathPattern: "/workspace/:wsId/preferences",
		auth: "subscriber",
		schema: { params: workspaceIdParamsSchema },
		async handler(ctx) {
			await requireMembership(ensureResolveWorkspaceRole(), ctx.subscriberId, ctx.params.wsId);
			const preferences = await preferenceRepository.findBySubscriber(ctx.subscriberId, {
				workspaceId: ctx.params.wsId,
			});
			return jsonResponse({ preferences });
		},
	});

	// PUT /workspace/:wsId/preferences — update subscriber's own workspace preferences
	router.add({
		method: "PUT",
		pathPattern: "/workspace/:wsId/preferences",
		auth: "subscriber",
		schema: {
			params: workspaceIdParamsSchema,
			body: workspacePreferenceBodySchema,
		},
		async handler(ctx) {
			await requireMembership(ensureResolveWorkspaceRole(), ctx.subscriberId, ctx.params.wsId);
			const preference = await preferenceRepository.upsert({
				subscriberId: ctx.subscriberId,
				workspaceId: ctx.params.wsId,
				topicKey: ctx.body.topicKey,
				channel: ctx.body.channel,
				enabled: ctx.body.enabled,
			});
			return jsonResponse(preference);
		},
	});
}
