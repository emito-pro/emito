import { classifyHttpStatus, defineProvider, deliveryError } from "@emito/provider-kit";
import type { DeliveryErrorContext } from "@emito/provider-kit";
import { EMITO_ERROR_CODE } from "@emito/types";
import type { EmitoErrorCode } from "@emito/types";
import twilio from "twilio";
import { z } from "zod";

export const TwilioProviderConfigSchema = z.object({
	accountSid: z.string().min(1, "accountSid is required"),
	authToken: z.string().min(1, "authToken is required"),
	fromNumber: z.string().min(1, "fromNumber is required"),
});

export type TwilioProviderConfig = z.infer<typeof TwilioProviderConfigSchema>;

/**
 * Twilio's numeric error codes are more specific than the HTTP status they
 * arrive with, so they drive the classification; the status is the fallback.
 */
const TWILIO_ERROR_MAP: Readonly<Record<number, { code: EmitoErrorCode; label: string }>> = {
	21211: { code: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS, label: "invalid address" },
	21614: { code: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS, label: "invalid address" },
	21610: { code: EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT, label: "unsubscribed recipient" },
	30005: { code: EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE, label: "hard bounce" },
	30006: { code: EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE, label: "hard bounce" },
	30003: { code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE, label: "destination unreachable" },
	20003: { code: EMITO_ERROR_CODE.CONFIG_INVALID, label: "authentication failed" },
};

interface TwilioContext {
	client: ReturnType<typeof twilio>;
	fromNumber: string;
}

export const createTwilioProvider = defineProvider<"sms", TwilioProviderConfig, TwilioContext>({
	name: "twilio",
	displayName: "Twilio",
	channel: "sms",
	configSchema: TwilioProviderConfigSchema,

	setup: ({ accountSid, authToken, fromNumber }) => ({
		client: twilio(accountSid, authToken),
		fromNumber,
	}),

	deliver: async (params, { client, fromNumber }) => {
		const message = await client.messages.create({
			body: params.body,
			to: params.to,
			from: fromNumber,
		});

		return {
			success: true,
			providerMessageId: message.sid,
		};
	},

	mapError: (err, errorContext) =>
		isTwilioError(err) ? mapTwilioError(err, errorContext) : undefined,
});

interface TwilioRestError {
	status: number;
	code: number;
	message: string;
}

function isTwilioError(err: unknown): err is TwilioRestError {
	if (!(err instanceof Error)) return false;
	const record = err as unknown as Record<string, unknown>;
	return typeof record.status === "number" && typeof record.code === "number";
}

function mapTwilioError(err: TwilioRestError, context: DeliveryErrorContext) {
	const errorContext = { ...context, twilioErrorCode: err.code };

	// A 429 status line outranks the error code: it is Twilio telling us to back off.
	const mapped = err.status === 429 ? undefined : TWILIO_ERROR_MAP[err.code];
	if (mapped) {
		return deliveryError(mapped.code, `Twilio ${mapped.label}: ${err.message}`, {
			context: errorContext,
		});
	}

	return deliveryError(
		classifyHttpStatus(err.status),
		`Twilio delivery failed (code ${err.code}, HTTP ${err.status}): ${err.message}`,
		{ context: errorContext },
	);
}
