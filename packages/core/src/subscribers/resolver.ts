import { EMITO_ERROR_CODE, EmitoError, type Subscriber } from "@emito/types";
import type { SubscriberRepository } from "../repositories/subscriber-repository";

export interface RecipientOverrides {
	email?: string;
	phone?: string;
	pushTokens?: string[];
}

export interface ResolvedSubscriber {
	subscriber: Subscriber;
	overridden: boolean;
}

export interface SubscriberResolverDeps {
	subscriberRepository: SubscriberRepository;
}

/**
 * Resolves a subscriber by ID from the repository, optionally merging
 * recipient overrides from SendParams.
 *
 * If the subscriber is not found in the repository and no recipient
 * overrides are provided, throws SUBSCRIBER_NOT_FOUND.
 *
 * If the subscriber is not found but recipient overrides are provided,
 * creates a minimal subscriber record from the overrides.
 */
export async function resolveSubscriber(
	subscriberId: string,
	recipient: RecipientOverrides | undefined,
	deps: SubscriberResolverDeps,
): Promise<ResolvedSubscriber> {
	const existing = await deps.subscriberRepository.findById(subscriberId);

	if (!existing && !recipient) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND,
			message: `Subscriber ${subscriberId} not found`,
			isRetryable: false,
			context: { subscriberId },
		});
	}

	if (!existing) {
		// Create a minimal subscriber from overrides (recipient guaranteed non-null by check above)
		const now = new Date();
		const subscriber: Subscriber = {
			id: subscriberId,
			email: recipient?.email,
			phone: recipient?.phone,
			pushTokens: recipient?.pushTokens,
			createdAt: now,
			updatedAt: now,
		};
		return { subscriber, overridden: true };
	}

	// Subscriber exists — merge overrides if provided
	if (recipient) {
		const merged: Subscriber = {
			...existing,
			email: recipient.email ?? existing.email,
			phone: recipient.phone ?? existing.phone,
			pushTokens: recipient.pushTokens ?? existing.pushTokens,
		};
		return { subscriber: merged, overridden: true };
	}

	// Subscriber exists, no overrides
	return { subscriber: existing, overridden: false };
}
