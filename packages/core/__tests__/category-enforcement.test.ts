import { type CategoryDefinition, EMITO_ERROR_CODE, EmitoError, type Subscriber } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import { enforceCategory } from "../src/categories/enforcement";
import { InMemoryConsentRepository } from "../src/repositories/in-memory/in-memory-consent-repository";
import { InMemorySubscriptionRepository } from "../src/repositories/in-memory/in-memory-subscription-repository";
import type { SubscriptionRecord } from "../src/repositories/types";

function makeSubscriber(overrides: Partial<Subscriber> = {}): Subscriber {
	return {
		id: "sub_1",
		email: "test@example.com",
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

function makeSubscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		id: "subscription_1",
		subscriberId: "sub_1",
		topicId: "newsletter",
		channel: "email",
		status: "opted_in",
		updatedAt: new Date(),
		...overrides,
	};
}

describe("Category Enforcement", () => {
	let subscriptionRepo: InMemorySubscriptionRepository;
	let consentRepo: InMemoryConsentRepository;

	beforeEach(() => {
		subscriptionRepo = new InMemorySubscriptionRepository();
		consentRepo = new InMemoryConsentRepository();
	});

	const deps = () => ({ subscriptionRepository: subscriptionRepo, consentRepository: consentRepo });

	describe("erased subscriber blocking", () => {
		it("throws SUBSCRIBER_ERASED for erased subscriber with transactional category", async () => {
			const subscriber = makeSubscriber({ erasedAt: new Date("2026-01-01") });
			const category: CategoryDefinition = { policy: "always" };

			await expect(enforceCategory(subscriber, category, "transactional", "any-topic", deps())).rejects.toThrow(
				EmitoError,
			);

			try {
				await enforceCategory(subscriber, category, "transactional", "any-topic", deps());
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.SUBSCRIBER_ERASED);
				expect(error.isRetryable).toBe(false);
				expect(error.context.subscriberId).toBe("sub_1");
			}
		});

		it("throws SUBSCRIBER_ERASED for erased subscriber with marketing category", async () => {
			const subscriber = makeSubscriber({ erasedAt: new Date("2026-01-01") });
			const category: CategoryDefinition = { policy: "opt_in" };

			await expect(enforceCategory(subscriber, category, "marketing", "newsletter", deps())).rejects.toThrow(
				EmitoError,
			);
		});

		it("throws SUBSCRIBER_ERASED for erased subscriber with product category", async () => {
			const subscriber = makeSubscriber({ erasedAt: new Date("2026-01-01") });
			const category: CategoryDefinition = { policy: "opt_out" };

			await expect(
				enforceCategory(subscriber, category, "product", "feature-announcement", deps()),
			).rejects.toThrow(EmitoError);
		});
	});

	describe("globally unsubscribed", () => {
		it("blocks non-transactional for globally unsubscribed subscriber (opt_in)", async () => {
			const subscriber = makeSubscriber({ globallyUnsubscribed: true });
			const category: CategoryDefinition = { policy: "opt_in" };

			try {
				await enforceCategory(subscriber, category, "marketing", "newsletter", deps());
				expect.fail("Should have thrown");
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.CATEGORY_BLOCKED);
				expect(error.isRetryable).toBe(false);
			}
		});

		it("blocks non-transactional for globally unsubscribed subscriber (opt_out)", async () => {
			const subscriber = makeSubscriber({ globallyUnsubscribed: true });
			const category: CategoryDefinition = { policy: "opt_out" };

			await expect(
				enforceCategory(subscriber, category, "product", "feature-announcement", deps()),
			).rejects.toThrow(EmitoError);
		});

		it("allows transactional for globally unsubscribed subscriber", async () => {
			const subscriber = makeSubscriber({ globallyUnsubscribed: true });
			const category: CategoryDefinition = { policy: "always" };

			await expect(
				enforceCategory(subscriber, category, "transactional", "password-reset", deps()),
			).resolves.toBeUndefined();
		});
	});

	describe("transactional (always policy)", () => {
		it("allows delivery unconditionally", async () => {
			const subscriber = makeSubscriber();
			const category: CategoryDefinition = { policy: "always" };

			await expect(
				enforceCategory(subscriber, category, "transactional", "password-reset", deps()),
			).resolves.toBeUndefined();
		});

		it("allows even when no subscriptions exist", async () => {
			const subscriber = makeSubscriber();
			const category: CategoryDefinition = { policy: "always" };

			await expect(
				enforceCategory(subscriber, category, "transactional", "2fa-code", deps()),
			).resolves.toBeUndefined();
		});
	});

	describe("marketing (opt_in policy)", () => {
		it("allows when subscriber has explicit opt-in", async () => {
			const subscriber = makeSubscriber();
			subscriptionRepo.seed(makeSubscription({ status: "opted_in", topicId: "newsletter" }));
			const category: CategoryDefinition = { policy: "opt_in" };

			await expect(
				enforceCategory(subscriber, category, "marketing", "newsletter", deps()),
			).resolves.toBeUndefined();
		});

		it("throws CONSENT_REQUIRED when no subscription exists", async () => {
			const subscriber = makeSubscriber();
			const category: CategoryDefinition = { policy: "opt_in" };

			try {
				await enforceCategory(subscriber, category, "marketing", "newsletter", deps());
				expect.fail("Should have thrown");
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.CONSENT_REQUIRED);
				expect(error.isRetryable).toBe(false);
				expect(error.context.topicKey).toBe("newsletter");
				expect(error.context.policy).toBe("opt_in");
			}
		});

		it("throws CONSENT_REQUIRED when subscriber is opted out", async () => {
			const subscriber = makeSubscriber();
			subscriptionRepo.seed(makeSubscription({ status: "opted_out", topicId: "newsletter" }));
			const category: CategoryDefinition = { policy: "opt_in" };

			await expect(enforceCategory(subscriber, category, "marketing", "newsletter", deps())).rejects.toThrow(
				EmitoError,
			);
		});

		it("allows when at least one subscription is opted in among multiple", async () => {
			const subscriber = makeSubscriber();
			subscriptionRepo.seed(
				makeSubscription({ id: "s1", status: "opted_out", topicId: "newsletter", channel: "sms" }),
			);
			subscriptionRepo.seed(
				makeSubscription({
					id: "s2",
					status: "opted_in",
					topicId: "newsletter",
					channel: "email",
				}),
			);
			const category: CategoryDefinition = { policy: "opt_in" };

			await expect(
				enforceCategory(subscriber, category, "marketing", "newsletter", deps()),
			).resolves.toBeUndefined();
		});

		it("allows when consent record grants access", async () => {
			const subscriber = makeSubscriber();
			const category: CategoryDefinition = { policy: "opt_in" };
			await consentRepo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
				source: "api",
			});

			await expect(
				enforceCategory(subscriber, category, "marketing", "newsletter", deps()),
			).resolves.toBeUndefined();
		});

		it("throws CONSENT_REQUIRED when latest consent is revoked", async () => {
			const subscriber = makeSubscriber();
			const category: CategoryDefinition = { policy: "opt_in" };
			await consentRepo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
				source: "api",
			});
			await consentRepo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: false,
				source: "api",
			});

			await expect(
				enforceCategory(subscriber, category, "marketing", "newsletter", deps()),
			).rejects.toThrow(EmitoError);
		});
	});

	describe("product (opt_out policy)", () => {
		it("allows when no subscription exists (default allow)", async () => {
			const subscriber = makeSubscriber();
			const category: CategoryDefinition = { policy: "opt_out" };

			await expect(
				enforceCategory(subscriber, category, "product", "feature-announcement", deps()),
			).resolves.toBeUndefined();
		});

		it("allows when subscriber is opted in", async () => {
			const subscriber = makeSubscriber();
			subscriptionRepo.seed(
				makeSubscription({ status: "opted_in", topicId: "feature-announcement" }),
			);
			const category: CategoryDefinition = { policy: "opt_out" };

			await expect(
				enforceCategory(subscriber, category, "product", "feature-announcement", deps()),
			).resolves.toBeUndefined();
		});

		it("throws CATEGORY_BLOCKED when subscriber has opted out", async () => {
			const subscriber = makeSubscriber();
			subscriptionRepo.seed(
				makeSubscription({ status: "opted_out", topicId: "feature-announcement" }),
			);
			const category: CategoryDefinition = { policy: "opt_out" };

			try {
				await enforceCategory(subscriber, category, "product", "feature-announcement", deps());
				expect.fail("Should have thrown");
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.CATEGORY_BLOCKED);
				expect(error.isRetryable).toBe(false);
				expect(error.context.topicKey).toBe("feature-announcement");
				expect(error.context.policy).toBe("opt_out");
			}
		});
	});

	describe("priority: erasedAt > globallyUnsubscribed > policy", () => {
		it("erasedAt takes priority over globallyUnsubscribed", async () => {
			const subscriber = makeSubscriber({
				erasedAt: new Date("2026-01-01"),
				globallyUnsubscribed: true,
			});
			const category: CategoryDefinition = { policy: "always" };

			try {
				await enforceCategory(subscriber, category, "transactional", "any-topic", deps());
				expect.fail("Should have thrown");
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.SUBSCRIBER_ERASED);
			}
		});

		it("globallyUnsubscribed takes priority over opt_in check", async () => {
			const subscriber = makeSubscriber({ globallyUnsubscribed: true });
			subscriptionRepo.seed(makeSubscription({ status: "opted_in", topicId: "newsletter" }));
			const category: CategoryDefinition = { policy: "opt_in" };

			try {
				await enforceCategory(subscriber, category, "marketing", "newsletter", deps());
				expect.fail("Should have thrown");
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.CATEGORY_BLOCKED);
			}
		});
	});
});
