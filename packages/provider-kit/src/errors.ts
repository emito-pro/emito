import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { Channel, DeliveryMetadata, EmitoErrorCode } from "@emito/types";

/**
 * The context every provider attaches to a delivery failure.
 *
 * Deliberately narrow: it carries correlation ids and nothing else. Recipient
 * addresses, webhook URLs, tokens and message bodies must never end up here —
 * this object is logged and persisted on dead-letter records.
 *
 * Declared as a type alias rather than an interface so it keeps an implicit
 * index signature and stays assignable to `Record<string, unknown>`.
 */
export type DeliveryErrorContext = {
	provider: string;
	channel: Channel;
	notificationId: string;
	subscriberId: string;
};

/** Builds the standard error context from a provider identity and delivery metadata. */
export function deliveryErrorContext(
	provider: string,
	channel: Channel,
	metadata: DeliveryMetadata,
): DeliveryErrorContext {
	return {
		provider,
		channel,
		notificationId: metadata.notificationId,
		subscriberId: metadata.subscriberId,
	};
}

export interface DeliveryErrorOptions {
	context?: Record<string, unknown>;
	cause?: Error;
}

/**
 * Builds an `EmitoError` for a delivery failure.
 *
 * `isRetryable` is intentionally not a parameter. Retryability is a property of
 * the error code, and `RETRYABLE_RECORD` in `@emito/types` is the single source
 * of truth the delivery engine reads when scheduling retries. A provider that
 * sets the flag by hand can only ever agree with that table or contradict it.
 */
export function deliveryError(
	code: EmitoErrorCode,
	message: string,
	options: DeliveryErrorOptions = {},
): EmitoError {
	return new EmitoError({
		code,
		message,
		context: options.context,
		cause: options.cause,
	});
}

/** Per-status classification overrides, e.g. `{ 404: DELIVERY_INVALID_ADDRESS }`. */
export type HttpStatusOverrides = Readonly<Record<number, EmitoErrorCode>>;

/**
 * The default HTTP status ladder shared by every HTTP-backed provider:
 * 429 is rate limiting, 5xx is the provider being down, everything else is a
 * rejection we should not retry.
 */
export function classifyHttpStatus(
	status: number,
	overrides?: HttpStatusOverrides,
): EmitoErrorCode {
	const override = overrides?.[status];
	if (override !== undefined) return override;
	if (status === 429) return EMITO_ERROR_CODE.RATE_LIMITED;
	if (status >= 500) return EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE;
	return EMITO_ERROR_CODE.DELIVERY_REJECTED;
}

export interface HttpDeliveryErrorParams {
	/** Human-facing provider name used in the message, e.g. "Slack". */
	displayName: string;
	status: number;
	/** Response body or provider message; appended to the error message, never to the context. */
	detail?: string;
	context?: Record<string, unknown>;
	overrides?: HttpStatusOverrides;
}

const HTTP_MESSAGE_PREFIX: Partial<Record<EmitoErrorCode, string>> = {
	[EMITO_ERROR_CODE.RATE_LIMITED]: "rate limited",
	[EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE]: "server error",
	[EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS]: "rejected the destination",
};

/**
 * Turns an unsuccessful HTTP response into a classified `EmitoError` using the
 * default ladder. Providers with a status their API gives a specific meaning
 * pass `overrides`, or throw their own `deliveryError` before calling this.
 */
export function httpDeliveryError(params: HttpDeliveryErrorParams): EmitoError {
	const code = classifyHttpStatus(params.status, params.overrides);
	const prefix = HTTP_MESSAGE_PREFIX[code] ?? "delivery failed";
	const detail = params.detail ? `: ${params.detail}` : "";

	return deliveryError(code, `${params.displayName} ${prefix} (${params.status})${detail}`, {
		context: params.context,
	});
}
