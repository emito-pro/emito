import type { NotificationRepository, SuppressionRepository } from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { Logger } from "@emito/types";
import { z } from "zod";
import { jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import type { ProcessWebhookDeps } from "./process.js";
import { processWebhook } from "./process.js";
import { postmarkVerifier } from "./providers/postmark.js";
import { resendVerifier } from "./providers/resend.js";
import { sendgridVerifier } from "./providers/sendgrid.js";
import { twilioVerifier } from "./providers/twilio.js";
import { vonageVerifier } from "./providers/vonage.js";
import type { WebhookVerifier } from "./types.js";

const PROVIDER_VERIFIERS: Record<string, WebhookVerifier> = {
	resend: resendVerifier,
	sendgrid: sendgridVerifier,
	twilio: twilioVerifier,
	postmark: postmarkVerifier,
	vonage: vonageVerifier,
};

const webhookParamsSchema = z.object({
	provider: z.string().min(1),
});

export interface WebhookEndpointDeps {
	notificationRepository: NotificationRepository;
	suppressionRepository: SuppressionRepository;
	/** Map of provider name to webhook secret. */
	webhookSecrets: Record<string, string>;
	/** Optional structured logger for webhook error logging. */
	logger?: Logger;
}

export function registerWebhookEndpoints(
	router: ReturnType<typeof createRouter>,
	deps: WebhookEndpointDeps,
): void {
	const processDeps: ProcessWebhookDeps = {
		notificationRepository: deps.notificationRepository,
		suppressionRepository: deps.suppressionRepository,
	};

	router.add({
		method: "POST",
		pathPattern: "/webhooks/:provider",
		auth: "public",
		// Inbound from Resend/Twilio/etc. The URL lives in the provider's console
		// and the payload contract is theirs, not ours — versioning it would force
		// a manual reconfiguration everywhere for a contract that never changed.
		unversioned: true,
		schema: { params: webhookParamsSchema },
		async handler(ctx, request) {
			const provider = ctx.params.provider;

			const verifier = PROVIDER_VERIFIERS[provider];
			if (!verifier) {
				deps.logger?.warn(
					{ provider, errorCode: EMITO_ERROR_CODE.WEBHOOK_PROVIDER_NOT_FOUND },
					"unknown webhook provider",
				);
				throw new EmitoError({
					code: EMITO_ERROR_CODE.WEBHOOK_PROVIDER_NOT_FOUND,
					message: `Unknown webhook provider: ${provider}`,
					context: { provider },
				});
			}

			const secret = deps.webhookSecrets[provider];
			if (!secret) {
				deps.logger?.warn(
					{ provider, errorCode: EMITO_ERROR_CODE.CONFIG_INVALID },
					"missing webhook secret",
				);
				throw new EmitoError({
					code: EMITO_ERROR_CODE.CONFIG_INVALID,
					message: `No webhook secret configured for provider: ${provider}`,
					context: { provider },
				});
			}

			const rawBody = ctx.rawBody;
			if (!rawBody) {
				deps.logger?.warn(
					{ provider, errorCode: EMITO_ERROR_CODE.WEBHOOK_PARSE_FAILED },
					"missing webhook body",
				);
				throw new EmitoError({
					code: EMITO_ERROR_CODE.WEBHOOK_PARSE_FAILED,
					message: "Missing request body for webhook verification",
					context: { provider },
				});
			}

			await processWebhook({
				provider,
				verifier,
				rawBody,
				headers: request.headers,
				secret,
				deps: processDeps,
				logger: deps.logger,
			});

			// Always return 200 to acknowledge receipt
			return jsonResponse({ received: true });
		},
	});
}
