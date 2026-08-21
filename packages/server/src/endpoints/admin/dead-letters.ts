import type { Emito } from "@emito/core";
import type { DeadLetterRepository } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { collectionResponse, jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { deadLetterFilterSchema, idParamSchema } from "../../schemas/admin.js";

export interface AdminDeadLetterDeps {
	deadLetterRepository: DeadLetterRepository;
	emito: Emito;
}

export function registerAdminDeadLetterEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: AdminDeadLetterDeps,
): void {
	const { deadLetterRepository, emito } = deps;

	// GET /admin/dead-letters — list exhausted notifications
	router.add({
		method: "GET",
		pathPattern: "/admin/dead-letters",
		auth: "admin",
		schema: { query: deadLetterFilterSchema },
		async handler(ctx) {
			const result = await deadLetterRepository.list({
				cursor: ctx.query.cursor,
				limit: ctx.query.limit,
				resolved: ctx.query.resolved,
			});
			return collectionResponse(result.items, result.hasMore, result.cursor);
		},
	});

	// POST /admin/dead-letters/:id/retry — manual retry
	router.add({
		method: "POST",
		pathPattern: "/admin/dead-letters/:id/retry",
		auth: "admin",
		schema: { params: idParamSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			const deadLetter = await deadLetterRepository.findById(id);
			if (!deadLetter) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.DEAD_LETTER_NOT_FOUND,
					message: `Dead letter ${id} not found`,
				});
			}

			if (deadLetter.resolvedAt || deadLetter.resolution === "retrying") {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
					message: `Dead letter ${id} is already resolved`,
				});
			}

			// Mark as retrying before send to prevent concurrent retries
			await deadLetterRepository.resolve(id, "retrying");

			try {
				// Re-enqueue by calling emito.send()
				await emito.send({
					event: deadLetter.eventType,
					subscriberId: deadLetter.subscriberId,
					payload: deadLetter.payload,
				});
			} catch (err) {
				// Send failed — clear retrying state so retry can be attempted again
				await deadLetterRepository.unresolve(id);
				throw err;
			}

			// Mark as retried on success
			await deadLetterRepository.resolve(id, "retried");

			return jsonResponse({ id, resolution: "retried" });
		},
	});

	// POST /admin/dead-letters/:id/discard — mark as discarded
	router.add({
		method: "POST",
		pathPattern: "/admin/dead-letters/:id/discard",
		auth: "admin",
		schema: { params: idParamSchema },
		async handler(ctx) {
			const id = ctx.params.id;
			const deadLetter = await deadLetterRepository.findById(id);
			if (!deadLetter) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.DEAD_LETTER_NOT_FOUND,
					message: `Dead letter ${id} not found`,
				});
			}

			if (deadLetter.resolvedAt) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
					message: `Dead letter ${id} is already resolved`,
				});
			}

			await deadLetterRepository.resolve(id, "discarded");

			return jsonResponse({ id, resolution: "discarded" });
		},
	});
}
