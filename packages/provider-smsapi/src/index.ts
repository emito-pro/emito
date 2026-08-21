import {
	classifyHttpStatus,
	defineProvider,
	deliveryError,
	httpDeliveryError,
	providerFetch,
} from "@emito/provider-kit";
import type { DeliveryErrorContext } from "@emito/provider-kit";
import { EMITO_ERROR_CODE } from "@emito/types";
import type { EmitoErrorCode } from "@emito/types";
import { z } from "zod";

export const SmsapiProviderConfigSchema = z.object({
	accessToken: z.string().min(1, "accessToken is required"),
	from: z.string().min(1, "from is required"),
	endpoint: z.string().optional(),
});

export type SmsapiProviderConfig = z.infer<typeof SmsapiProviderConfigSchema>;

const DEFAULT_ENDPOINT = "https://api.smsapi.pl/sms.do";

/**
 * SMSAPI reports application-level failures in the body of an HTTP 200, so its
 * numeric error codes carry the classification rather than the status line.
 */
const SMSAPI_ERROR_MAP: Readonly<Record<number, { code: EmitoErrorCode; label: string }>> = {
	101: { code: EMITO_ERROR_CODE.CONFIG_INVALID, label: "authentication failed" },
	102: { code: EMITO_ERROR_CODE.CONFIG_INVALID, label: "authentication failed" },
	13: { code: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS, label: "invalid address" },
	14: { code: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS, label: "invalid address" },
	8: { code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE, label: "temporary error" },
	201: { code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE, label: "temporary error" },
};

interface SmsapiSuccessResponse {
	count: number;
	list: [{ id: string; points?: unknown; number?: unknown; status?: unknown }, ...unknown[]];
}

interface SmsapiErrorResponse {
	error: number;
	message: string;
}

function isSmsapiErrorResponse(json: unknown): json is SmsapiErrorResponse {
	return (
		typeof json === "object" &&
		json !== null &&
		typeof (json as Record<string, unknown>).error === "number"
	);
}

function isSmsapiSuccessResponse(json: unknown): json is SmsapiSuccessResponse {
	return (
		typeof json === "object" &&
		json !== null &&
		Array.isArray((json as Record<string, unknown>).list) &&
		(json as SmsapiSuccessResponse).list.length > 0 &&
		typeof (json as SmsapiSuccessResponse).list[0]?.id === "string"
	);
}

export const createSmsapiProvider = defineProvider<"sms", SmsapiProviderConfig, SmsapiContext>({
	name: "smsapi",
	displayName: "SMSAPI",
	channel: "sms",
	configSchema: SmsapiProviderConfigSchema,

	setup: ({ accessToken, from, endpoint }) => ({
		accessToken,
		from,
		url: endpoint ?? DEFAULT_ENDPOINT,
	}),

	deliver: async (params, { accessToken, from, url }, errorContext) => {
		const body = new URLSearchParams({
			to: params.to.replace(/^\+/, ""),
			from,
			message: params.body,
			format: "json",
			encoding: "utf-8",
		});

		const response = await providerFetch(
			url,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body,
			},
			{ displayName: "SMSAPI", context: errorContext },
		);

		const json: unknown = await response.json();

		if (isSmsapiErrorResponse(json)) {
			throw mapSmsapiError(json, response.status, errorContext);
		}

		if (!response.ok) {
			throw httpDeliveryError({
				displayName: "SMSAPI",
				status: response.status,
				context: errorContext,
			});
		}

		if (isSmsapiSuccessResponse(json)) {
			const [first] = json.list;
			return {
				success: true,
				providerMessageId: first.id,
			};
		}

		throw deliveryError(
			EMITO_ERROR_CODE.DELIVERY_REJECTED,
			"SMSAPI returned an unrecognized response shape",
			{ context: { ...errorContext, smsapiResponse: json } },
		);
	},
});

interface SmsapiContext {
	accessToken: string;
	from: string;
	url: string;
}

function mapSmsapiError(
	err: SmsapiErrorResponse,
	status: number,
	context: DeliveryErrorContext,
): Error {
	const errorContext = { ...context, smsapiError: err.error };

	// A 429 status line outranks the body code: it is the transport telling us to back off.
	const mapped = status === 429 ? undefined : SMSAPI_ERROR_MAP[err.error];
	if (mapped) {
		return deliveryError(mapped.code, `SMSAPI ${mapped.label}: ${err.message}`, {
			context: errorContext,
		});
	}

	return deliveryError(
		classifyHttpStatus(status),
		`SMSAPI delivery failed (error ${err.error}, HTTP ${status}): ${err.message}`,
		{ context: errorContext },
	);
}
