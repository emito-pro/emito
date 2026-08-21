import type {
	Channel,
	ChannelDeliveryParams,
	EmitoErrorCode,
	ErrorClassification,
	ProviderPlugin,
	RetryPolicy,
} from "@emito/types";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";

export interface RetryContext {
	notificationId: string;
	subscriberId: string;
	eventType: string;
	channel: Channel;
}

export interface AttemptEntry {
	attempt: number;
	success: boolean;
	timestamp: Date;
	errorCode?: string;
	errorMessage?: string;
}

export interface RetryResult {
	success: boolean;
	attempts: number;
	permanent?: boolean;
	exhausted?: boolean;
	rateLimited?: boolean;
	isRetryable?: boolean;
	errorCode?: EmitoErrorCode;
	errorMessage?: string;
	errorClassification?: ErrorClassification;
	providerMessageId?: string;
	invalidTokens?: string[];
	attemptHistory: AttemptEntry[];
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxAttempts: 3,
	initialDelay: 1000,
	maxDelay: 60_000,
	backoff: "exponential",
	jitter: true,
};

export function getRetryPolicy(policy?: RetryPolicy): RetryPolicy {
	return policy ?? DEFAULT_RETRY_POLICY;
}

export function calculateDelay(attempt: number, policy: RetryPolicy): number {
	if (attempt <= 1) return 0;

	const retryIndex = attempt - 2;
	let baseDelay: number;

	if (policy.backoff === "exponential") {
		baseDelay = Math.min(policy.initialDelay * 2 ** retryIndex, policy.maxDelay);
	} else {
		baseDelay = Math.min(policy.initialDelay * (retryIndex + 1), policy.maxDelay);
	}

	if (policy.jitter) {
		return applyJitter(baseDelay);
	}

	return baseDelay;
}

export function applyJitter(delay: number): number {
	if (delay === 0) return 0;
	const jitterFactor = 0.8 + Math.random() * 0.4;
	return Math.round(delay * jitterFactor);
}

export function shouldRetry(attempt: number, policy: RetryPolicy): boolean {
	return attempt < policy.maxAttempts;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWithRetry(
	provider: ProviderPlugin,
	deliveryParams: ChannelDeliveryParams,
	retryPolicy: RetryPolicy,
	_context: RetryContext,
): Promise<RetryResult> {
	const attemptHistory: AttemptEntry[] = [];

	for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
		if (attempt > 1) {
			const delay = calculateDelay(attempt, retryPolicy);
			if (delay > 0) {
				await sleep(delay);
			}
		}

		try {
			const result = await provider.deliver(deliveryParams);

			attemptHistory.push({
				attempt,
				success: result.success,
				timestamp: new Date(),
			});

			if (result.success) {
				return {
					success: true,
					attempts: attempt,
					providerMessageId: result.providerMessageId,
					invalidTokens: result.invalidTokens,
					attemptHistory,
				};
			}

			// Only "permanent" is handled in the DeliveryResult return path.
			// Other classifications (soft_bounce, transient, rate_limited) fall through
			// and exhaust via the loop end. DeliveryResult has no errorCode field, so
			// DELIVERY_REJECTED is the safe default (not in SUPPRESSABLE_ERROR_CODES — no suppression).
			// Provider authors: throw EmitoError with the specific code instead
			// of returning a DeliveryResult to get correct error classification and suppression behavior.
			if (result.errorClassification === "permanent") {
				return {
					success: false,
					attempts: attempt,
					permanent: true,
					isRetryable: false,
					errorCode: EMITO_ERROR_CODE.DELIVERY_REJECTED,
					errorMessage: result.error,
					errorClassification: "permanent",
					attemptHistory,
				};
			}
		} catch (err: unknown) {
			const emitError =
				err instanceof EmitoError
					? err
					: EmitoError.fromUnknown(err, {
							code: EMITO_ERROR_CODE.DELIVERY_FAILED,
							isRetryable: true,
						});

			attemptHistory.push({
				attempt,
				success: false,
				timestamp: new Date(),
				errorCode: emitError.code,
				errorMessage: emitError.message,
			});

			if (!emitError.isRetryable) {
				return {
					success: false,
					attempts: attempt,
					permanent: true,
					isRetryable: false,
					errorCode: emitError.code,
					errorMessage: emitError.message,
					errorClassification: "permanent",
					attemptHistory,
				};
			}

			if (emitError.code === EMITO_ERROR_CODE.RATE_LIMITED) {
				if (!shouldRetry(attempt, retryPolicy)) {
					return {
						success: false,
						attempts: attempt,
						exhausted: true,
						rateLimited: true,
						isRetryable: true,
						errorCode: emitError.code,
						errorMessage: emitError.message,
						errorClassification: "rate_limited",
						attemptHistory,
					};
				}

				const retryAfter = (emitError.context as Record<string, unknown>)?.retryAfter;
				if (typeof retryAfter === "number" && retryAfter > 0) {
					await sleep(retryAfter);
				}
				continue;
			}

			if (!shouldRetry(attempt, retryPolicy)) {
				const isSoftBounce = emitError.code === EMITO_ERROR_CODE.DELIVERY_SOFT_BOUNCE;
				return {
					success: false,
					attempts: attempt,
					exhausted: true,
					isRetryable: true,
					errorCode: emitError.code,
					errorMessage: emitError.message,
					errorClassification: isSoftBounce ? "soft_bounce" : "transient",
					attemptHistory,
				};
			}
		}
	}

	return {
		success: false,
		attempts: retryPolicy.maxAttempts,
		exhausted: true,
		isRetryable: true,
		errorCode: EMITO_ERROR_CODE.ALL_PROVIDERS_EXHAUSTED,
		errorMessage: "Max retries exhausted",
		errorClassification: "transient",
		attemptHistory,
	};
}
