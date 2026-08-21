import {
	type ChannelDeliveryParams,
	EMITO_ERROR_CODE,
	EmitoError,
	type ProviderPlugin,
	type RetryPolicy,
	SUPPRESSABLE_ERROR_CODES,
} from "@emito/types";
import type { CircuitBreaker } from "../circuit-breaker";
import type { Logger } from "../observability/logger";
import type { DeadLetterRepository } from "../repositories/dead-letter-repository";
import type { NotificationRepository } from "../repositories/notification-repository";
import type { PushTokenRepository } from "../repositories/push-token-repository";
import type { SuppressionRepository } from "../repositories/suppression-repository";
import type { DeadLetterAttempt } from "../repositories/types";
import { checkSuppression } from "../suppression/checker";
import { executeWithRetry, getRetryPolicy } from "./retry";
import type { RetryContext } from "./retry";
import { createPriorityStrategy } from "./strategies/priority";
import { createRoundRobinStrategy } from "./strategies/round-robin";
import type { DispatchStrategy } from "./strategies/types";
import { createWeightedStrategy } from "./strategies/weighted";

export interface DispatchParams {
	providers: ProviderPlugin[];
	strategy: "priority" | "round_robin" | "weighted";
	deliveryParams: ChannelDeliveryParams;
	retryPolicy?: RetryPolicy;
	weights?: number[];
	notificationRepository: NotificationRepository;
	suppressionRepository: SuppressionRepository;
	deadLetterRepository: DeadLetterRepository;
	pushTokenRepository: PushTokenRepository;
	logger?: Logger;
	circuitBreaker?: CircuitBreaker;
}

export interface DispatchResult {
	success: boolean;
	provider?: string;
	providerMessageId?: string;
	suppressed?: boolean;
	exhausted?: boolean;
	permanent?: boolean;
	errorCode?: string;
	errorMessage?: string;
}

function createStrategy(
	strategyName: "priority" | "round_robin" | "weighted",
	channel: string,
	weights?: number[],
): DispatchStrategy {
	switch (strategyName) {
		case "priority":
			return createPriorityStrategy();
		case "round_robin":
			return createRoundRobinStrategy(channel);
		case "weighted":
			return createWeightedStrategy(weights ?? []);
		default:
			return createPriorityStrategy();
	}
}

function getAddressFromParams(params: ChannelDeliveryParams): string {
	switch (params.channel) {
		case "email":
			return params.to;
		case "sms":
		case "whatsapp":
			return params.to;
		case "push":
			return params.metadata.subscriberId;
		case "slack":
			return params.webhookUrl;
		case "telegram":
			return params.chatId;
		case "discord":
			return params.webhookUrl;
		case "inApp":
			return params.subscriberId;
		case "webhook":
			return params.url;
		case "webPush":
			return params.subscription.endpoint;
		default:
			return "unknown";
	}
}

export async function dispatch(params: DispatchParams): Promise<DispatchResult> {
	const {
		providers,
		strategy: strategyName,
		deliveryParams,
		retryPolicy: retryPolicyParam,
		weights,
		notificationRepository,
		suppressionRepository,
		deadLetterRepository,
		pushTokenRepository,
		logger,
		circuitBreaker,
	} = params;

	const { notificationId, subscriberId, eventType } = deliveryParams.metadata;
	const channel = deliveryParams.channel;
	const retryPolicy = getRetryPolicy(retryPolicyParam);

	// Pre-send suppression check
	const address = getAddressFromParams(deliveryParams);
	const suppressionResult = await checkSuppression(suppressionRepository, { address, channel });
	if (suppressionResult.suppressed) {
		try {
			await notificationRepository.updateStatus(notificationId, "suppressed");
		} catch (err) {
			logger?.warn(
				{ notificationId, error: String(err) },
				"failed to update notification status to suppressed",
			);
		}
		return {
			success: false,
			suppressed: true,
		};
	}

	const strategy = createStrategy(strategyName, channel, weights);
	const exhaustedProviders = new Set<string>();
	const allAttempts: DeadLetterAttempt[] = [];

	while (true) {
		const provider = strategy.selectProvider(providers, { exhaustedProviders });

		if (!provider) {
			// All providers exhausted — write to DLQ
			await deadLetterRepository.create({
				notificationId,
				subscriberId,
				eventType,
				channel,
				attempts: allAttempts,
				payload: deliveryParams as unknown as Record<string, unknown>,
			});

			try {
				await notificationRepository.updateStatus(notificationId, "failed", {
					errorMessage: "All providers exhausted",
					failedAt: new Date(),
					attempts: allAttempts.length,
				});
			} catch (err) {
				logger?.warn(
					{ notificationId, error: String(err) },
					"failed to update notification status after DLQ write",
				);
			}

			return {
				success: false,
				exhausted: true,
				errorCode: EMITO_ERROR_CODE.ALL_PROVIDERS_EXHAUSTED,
				errorMessage: "All providers exhausted",
			};
		}

		// Circuit breaker gate: skip provider if circuit is open
		if (circuitBreaker) {
			const allowed = await circuitBreaker.isAllowed(provider.name, channel);
			if (!allowed) {
				logger?.debug(
					{ provider: provider.name, channel },
					"circuit breaker open, skipping provider",
				);
				exhaustedProviders.add(provider.name);
				continue;
			}
		}

		const retryContext: RetryContext = {
			notificationId,
			subscriberId,
			eventType,
			channel,
		};

		const result = await executeWithRetry(provider, deliveryParams, retryPolicy, retryContext);

		// Collect attempt history for DLQ
		for (const entry of result.attemptHistory) {
			allAttempts.push({
				provider: provider.name,
				timestamp: entry.timestamp,
				errorCode: entry.errorCode ?? (entry.success ? "SUCCESS" : "UNKNOWN"),
				errorMessage:
					entry.errorMessage ?? (entry.success ? "Delivery successful" : "Unknown error"),
			});
		}

		if (result.success) {
			// Record success with circuit breaker
			if (circuitBreaker) {
				await circuitBreaker.recordSuccess(provider.name, channel);
			}

			// Deactivate invalid push tokens
			if (result.invalidTokens && result.invalidTokens.length > 0) {
				for (const token of result.invalidTokens) {
					try {
						await pushTokenRepository.deactivateByToken(token);
					} catch (err) {
						logger?.warn(
							{ notificationId, token, error: String(err) },
							"failed to deactivate invalid push token",
						);
					}
				}
			}

			try {
				await notificationRepository.updateStatus(notificationId, "sent", {
					provider: provider.name,
					providerMsgId: result.providerMessageId,
					sentAt: new Date(),
					attempts: allAttempts.length,
				});
			} catch (err) {
				logger?.warn(
					{ notificationId, error: String(err) },
					"failed to update notification status to sent",
				);
			}

			return {
				success: true,
				provider: provider.name,
				providerMessageId: result.providerMessageId,
			};
		}

		if (result.permanent) {
			// Record failure with circuit breaker
			if (circuitBreaker) {
				await circuitBreaker.recordFailure(provider.name, channel);
			}

			// Push channel: deactivate all tokens instead of suppressing
			// When DELIVERY_INVALID_ADDRESS on push, all tokens are dead — deactivate them all
			if (
				deliveryParams.channel === "push" &&
				result.errorCode === EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS
			) {
				for (const token of deliveryParams.tokens) {
					try {
						await pushTokenRepository.deactivateByToken(token);
					} catch (err) {
						logger?.warn(
							{ notificationId, token, error: String(err) },
							"failed to deactivate invalid push token",
						);
					}
				}
			} else if (result.errorCode && SUPPRESSABLE_ERROR_CODES.has(result.errorCode)) {
				// Only suppress address for error codes in the suppressable allowlist (non-push)
				await suppressionRepository.create({
					address,
					channel,
					reason: result.errorMessage ?? "Permanent delivery failure",
					provider: provider.name,
				});
			}

			try {
				await notificationRepository.updateStatus(notificationId, "failed", {
					provider: provider.name,
					errorMessage: result.errorMessage,
					errorClassification: result.errorClassification ?? "permanent",
					failedAt: new Date(),
					attempts: allAttempts.length,
				});
			} catch (err) {
				logger?.warn(
					{ notificationId, error: String(err) },
					"failed to update notification status after permanent error",
				);
			}

			return {
				success: false,
				permanent: true,
				provider: provider.name,
				errorCode: result.errorCode,
				errorMessage: result.errorMessage,
			};
		}

		// Provider exhausted (transient/rate-limited) — record failure and try next
		if (circuitBreaker) {
			await circuitBreaker.recordFailure(provider.name, channel);
		}
		exhaustedProviders.add(provider.name);
	}
}
