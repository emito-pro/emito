import { defineProvider, deliveryError, httpDeliveryError } from "@emito/provider-kit";
import type { DeliveryErrorContext } from "@emito/provider-kit";
import { EMITO_ERROR_CODE } from "@emito/types";
import { Resend } from "resend";
import { z } from "zod";

export const ResendProviderConfigSchema = z.object({
	apiKey: z.string().min(1, "apiKey is required"),
	fromAddress: z.string().min(1, "fromAddress is required"),
	replyTo: z.string().optional(),
});

export type ResendProviderConfig = z.infer<typeof ResendProviderConfigSchema>;

interface ResendContext {
	client: Resend;
	fromAddress: string;
	replyTo: string | undefined;
}

export const createResendProvider = defineProvider<"email", ResendProviderConfig, ResendContext>({
	name: "resend",
	displayName: "Resend",
	channel: "email",
	configSchema: ResendProviderConfigSchema,

	setup: ({ apiKey, fromAddress, replyTo }) => ({
		client: new Resend(apiKey),
		fromAddress,
		replyTo,
	}),

	deliver: async (params, { client, fromAddress, replyTo }, errorContext) => {
		const response = await client.emails.send({
			from: fromAddress,
			to: [params.to],
			subject: params.subject,
			html: params.html,
			text: params.text,
			replyTo: replyTo ?? params.replyTo,
			headers: {
				"X-Entity-Ref-ID": params.metadata.notificationId,
			},
		});

		if (response.error) {
			throw mapResendError(response.error, errorContext);
		}

		return {
			success: true,
			providerMessageId: response.data?.id,
		};
	},
});

/**
 * Resend reports failures as a `{ name, message }` pair with no status code, so
 * the name has to be translated back into one before the shared HTTP ladder can
 * classify it.
 */
const RESEND_ERROR_STATUS: Record<string, number> = {
	missing_required_field: 422,
	invalid_idempotency_key: 400,
	invalid_idempotent_request: 409,
	concurrent_idempotent_requests: 409,
	invalid_access: 422,
	invalid_parameter: 422,
	invalid_region: 422,
	rate_limit_exceeded: 429,
	missing_api_key: 401,
	invalid_api_Key: 403,
	invalid_from_address: 403,
	validation_error: 403,
	not_found: 404,
	method_not_allowed: 405,
	application_error: 500,
	internal_server_error: 500,
};

function mapResendError(
	error: { message: string; name: string },
	context: DeliveryErrorContext,
): Error {
	if (isInvalidAddressError(error.name, error.message)) {
		return deliveryError(
			EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS,
			`Resend invalid address: ${error.message}`,
			{ context },
		);
	}

	return httpDeliveryError({
		displayName: "Resend",
		status: RESEND_ERROR_STATUS[error.name] ?? 500,
		detail: error.message,
		context,
	});
}

function isInvalidAddressError(name: string, message: string): boolean {
	// invalid_from_address is about the sender, not the recipient
	if (name === "invalid_from_address") return false;

	if (
		name === "validation_error" ||
		name === "missing_required_field" ||
		name === "invalid_parameter"
	) {
		const lower = message.toLowerCase();
		return (
			lower.includes("recipient") ||
			lower.includes("address") ||
			(lower.includes("to") && lower.includes("invalid"))
		);
	}
	return false;
}
