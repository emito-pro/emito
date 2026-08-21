import {
	type CategoryDefinition,
	EMITO_ERROR_CODE,
	EmitoError,
	type Subscriber,
} from "@emito/types";
import type { ConsentRepository } from "../repositories/consent-repository";
import type { SubscriptionRepository } from "../repositories/subscription-repository";

export interface CategoryEnforcementDeps {
	subscriptionRepository: SubscriptionRepository;
	consentRepository: ConsentRepository;
}

/**
 * Checks whether a notification can be delivered to a subscriber based on
 * category policy and subscription state.
 *
 * Enforcement order:
 * 1. If subscriber.erasedAt is set -> block all (SUBSCRIBER_ERASED)
 * 2. If subscriber.globallyUnsubscribed AND category != transactional -> block (CATEGORY_BLOCKED)
 * 3. 'always' policy (transactional) -> allow
 * 4. 'opt_in' policy (marketing) -> check subscriptions for explicit opt-in
 * 5. 'opt_out' policy (product) -> check subscriptions for explicit opt-out
 */
export async function enforceCategory(
	subscriber: Subscriber,
	category: CategoryDefinition,
	categoryKey: string,
	topicKey: string,
	deps: CategoryEnforcementDeps,
): Promise<void> {
	// 1. Erased subscriber — block all
	if (subscriber.erasedAt) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.SUBSCRIBER_ERASED,
			message: `Subscriber ${subscriber.id} has been erased`,
			isRetryable: false,
			context: { subscriberId: subscriber.id, erasedAt: subscriber.erasedAt },
		});
	}

	// 2. Globally unsubscribed — block non-transactional
	if (subscriber.globallyUnsubscribed && category.policy !== "always") {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.CATEGORY_BLOCKED,
			message: `Subscriber ${subscriber.id} is globally unsubscribed`,
			isRetryable: false,
			context: { subscriberId: subscriber.id, policy: category.policy },
		});
	}

	// 3. 'always' policy (transactional) — allow unconditionally
	if (category.policy === "always") {
		return;
	}

	// 4. 'opt_in' policy (marketing) — require explicit opt-in
	if (category.policy === "opt_in") {
		const subscriptions = await deps.subscriptionRepository.findBySubscriberAndTopic(
			subscriber.id,
			topicKey,
		);

		const hasOptIn = subscriptions.some((s) => s.status === "opted_in");
		if (hasOptIn) {
			return;
		}

		const latestConsent = await deps.consentRepository.getLatestConsent(subscriber.id, categoryKey);
		if (latestConsent?.consented) {
			return;
		}

		throw new EmitoError({
			code: EMITO_ERROR_CODE.CONSENT_REQUIRED,
			message: `Subscriber ${subscriber.id} has not opted in to topic ${topicKey}`,
			isRetryable: false,
			context: { subscriberId: subscriber.id, topicKey, policy: "opt_in" },
		});
	}

	// 5. 'opt_out' policy (product) — allow unless explicitly opted out
	if (category.policy === "opt_out") {
		const subscriptions = await deps.subscriptionRepository.findBySubscriberAndTopic(
			subscriber.id,
			topicKey,
		);

		const hasOptOut = subscriptions.some((s) => s.status === "opted_out");
		if (hasOptOut) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.CATEGORY_BLOCKED,
				message: `Subscriber ${subscriber.id} has opted out of topic ${topicKey}`,
				isRetryable: false,
				context: { subscriberId: subscriber.id, topicKey, policy: "opt_out" },
			});
		}

		return;
	}

	// Unknown policy — defensive fallback
	throw new EmitoError({
		code: EMITO_ERROR_CODE.CONFIG_INVALID,
		message: `Unknown category policy: ${category.policy}`,
		isRetryable: false,
		context: { policy: category.policy },
	});
}
