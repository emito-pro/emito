import {
	type Channel,
	type ChannelDeliveryParams,
	type DeliveryResult,
	EMITO_ERROR_CODE,
	EmitoError,
	type ProviderPlugin,
} from "@emito/types";

export type MockProviderMode =
	| "succeed"
	| "transient"
	| "permanent"
	| "rejected"
	| "hard_bounce"
	| "soft_bounce"
	| "spam_complaint"
	| "invalid_address"
	| "rate-limited"
	| "timeout";

export interface MockProviderOptions {
	name?: string;
	mode?: MockProviderMode;
	failTimes?: number;
	timeoutMs?: number;
	healthy?: boolean;
}

export interface MockProvider extends ProviderPlugin {
	readonly calls: ChannelDeliveryParams[];
	reset(): void;
}

export function createMockProvider(
	channel: Channel,
	options: MockProviderOptions = {},
): MockProvider {
	const {
		name = `mock-${channel}`,
		mode = "succeed",
		failTimes,
		timeoutMs = 5000,
		healthy = true,
	} = options;

	const calls: ChannelDeliveryParams[] = [];
	let failCount = 0;

	function shouldFail(): boolean {
		if (mode === "succeed") return false;
		if (failTimes !== undefined) {
			if (failCount >= failTimes) return false;
			failCount++;
			return true;
		}
		return true;
	}

	async function deliver(params: ChannelDeliveryParams): Promise<DeliveryResult> {
		calls.push(params);

		if (!shouldFail()) {
			return {
				success: true,
				providerMessageId: `mock_msg_${calls.length}`,
			};
		}

		switch (mode) {
			case "transient":
				throw new EmitoError({
					code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE,
					message: `Mock transient error from ${name}`,
					isRetryable: true,
				});

			case "permanent":
			case "rejected":
				throw new EmitoError({
					code: EMITO_ERROR_CODE.DELIVERY_REJECTED,
					message: `Mock rejected error from ${name}`,
					isRetryable: false,
				});

			case "hard_bounce":
				throw new EmitoError({
					code: EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE,
					message: `Mock hard bounce from ${name}`,
					isRetryable: false,
				});

			case "soft_bounce":
				throw new EmitoError({
					code: EMITO_ERROR_CODE.DELIVERY_SOFT_BOUNCE,
					message: `Mock soft bounce from ${name}`,
					isRetryable: true,
				});

			case "spam_complaint":
				throw new EmitoError({
					code: EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT,
					message: `Mock spam complaint from ${name}`,
					isRetryable: false,
				});

			case "invalid_address":
				throw new EmitoError({
					code: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS,
					message: `Mock invalid address from ${name}`,
					isRetryable: false,
				});

			case "rate-limited":
				throw new EmitoError({
					code: EMITO_ERROR_CODE.RATE_LIMITED,
					message: `Mock rate limit from ${name}`,
					isRetryable: true,
				});

			case "timeout": {
				const promise = new Promise<DeliveryResult>((_resolve, reject) => {
					setTimeout(() => {
						reject(
							new EmitoError({
								code: EMITO_ERROR_CODE.PROVIDER_TIMEOUT,
								message: `Mock timeout from ${name} after ${timeoutMs}ms`,
								isRetryable: true,
								context: { provider: name, timeoutMs },
							}),
						);
					}, timeoutMs);
				});
				// Prevent unhandled rejection warning — caller is expected to catch
				promise.catch(() => {});
				return promise;
			}

			default:
				return { success: true, providerMessageId: `mock_msg_${calls.length}` };
		}
	}

	async function healthCheck(): Promise<boolean> {
		return healthy;
	}

	return {
		name,
		channel,
		calls,
		deliver,
		healthCheck,
		reset() {
			calls.length = 0;
			failCount = 0;
		},
	};
}
