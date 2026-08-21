/**
 * Tests for emito.on() / emito.off() — typed event emitter on the Emito instance.
 *
 * Covers:
 * - emito.on() and emito.off() are available on the Emito interface
 * - emito.on('notification:created', cb) fires after an inApp notification is delivered
 * - Callback receives (subscriberId, NotificationEvent) with correct values
 * - emito.off() removes listener so it no longer fires
 * - Multiple listeners all fire
 * - Event does NOT fire for non-inApp channels (email only)
 * - Event fires once per send() when one inApp write occurs
 *
 * Rules applied:
 * - Use in-memory repositories for unit tests (rule 12)
 * - Use test data builders, never inline literals (rule 7)
 * - Assert on call arguments (rule 28)
 * - Assert on shape of return values, not just existence (rule 26)
 * - Prefer specific matchers (rule 25)
 * - Follow naming convention (rule 15)
 * - Reset all mocks in afterEach (rule 14)
 */

import type { NotificationEvent } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmito } from "../src/emito";
import {
	InMemoryConsentRepository,
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemoryPushTokenRepository,
	InMemorySubscriberRepository,
	InMemorySubscriptionRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "../src/repositories/in-memory/index";
import { createMockProvider } from "../src/testing/mock-provider";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function createRepositories() {
	return {
		subscriberRepository: new InMemorySubscriberRepository(),
		notificationRepository: new InMemoryNotificationRepository(),
		preferenceRepository: new InMemoryPreferenceRepository(),
		workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
		suppressionRepository: new InMemorySuppressionRepository(),
		subscriptionRepository: new InMemorySubscriptionRepository(),
		deadLetterRepository: new InMemoryDeadLetterRepository(),
		integrationRepository: new InMemoryIntegrationRepository(),
		inboxRepository: new InMemoryInboxRepository(),
		consentRepository: new InMemoryConsentRepository(),
		pushTokenRepository: new InMemoryPushTokenRepository(),
	};
}

function createSubscriberData(overrides: Partial<{ id: string; email: string | null }> = {}) {
	return {
		id: "sub_1",
		email: "user@example.com",
		phone: null,
		lang: "en",
		timezone: null,
		globallyUnsubscribed: false,
		metadata: {},
		erasedAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function createMinimalValidConfig(overrides: Record<string, unknown> = {}) {
	return {
		database: { url: "postgresql://localhost:5432/test" },
		redis: { url: "redis://localhost:6379" },
		events: {
			"user.welcome": {
				category: "transactional",
				channels: ["inApp" as const],
			},
			"user.promo": {
				category: "transactional",
				channels: ["email" as const],
			},
		},
		categories: {
			transactional: { policy: "always" as const },
		},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// emito.on / emito.off — event emitter API surface
// ---------------------------------------------------------------------------

describe("Emito — event emitter", () => {
	let repos: ReturnType<typeof createRepositories>;
	let inAppProvider: ReturnType<typeof createMockProvider>;
	let emailProvider: ReturnType<typeof createMockProvider>;

	beforeEach(() => {
		repos = createRepositories();
		inAppProvider = createMockProvider("inApp");
		emailProvider = createMockProvider("email");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -------------------------------------------------------------------------
	// API surface
	// -------------------------------------------------------------------------

	describe("API surface", () => {
		it("should expose on() and off() on the returned Emito instance", () => {
			const emito = createEmito({
				...createMinimalValidConfig(),
				repositories: repos,
			});

			expect(typeof emito.on).toBe("function");
			expect(typeof emito.off).toBe("function");
		});
	});

	// -------------------------------------------------------------------------
	// notification:created fires after inApp send
	// -------------------------------------------------------------------------

	describe("notification:created", () => {
		it("should fire after emito.send() delivers an inApp notification", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						inApp: { providers: [inAppProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const listener = vi.fn();
			emito.on("notification:created", listener);

			await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: { greeting: "Hello" },
			});

			expect(listener).toHaveBeenCalledOnce();
		});

		it("should call listener with (subscriberId, NotificationEvent) where subscriberId matches the subscriber", async () => {
			const subscriber = createSubscriberData({ id: "sub_42" });
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						inApp: { providers: [inAppProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const listener = vi.fn();
			emito.on("notification:created", listener);

			await emito.send({
				event: "user.welcome",
				subscriberId: "sub_42",
				payload: {},
			});

			const [receivedSubscriberId, receivedEvent] = listener.mock.calls[0] as [
				string,
				NotificationEvent,
			];
			expect(receivedSubscriberId).toBe("sub_42");
			expect(receivedEvent).toMatchObject({
				notificationId: expect.any(String),
				subscriberId: "sub_42",
				event: "user.welcome",
				body: expect.any(String),
				timestamp: expect.any(Date),
			});
		});

		it("should call all registered listeners when inApp notification is sent", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						inApp: { providers: [inAppProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const listenerA = vi.fn();
			const listenerB = vi.fn();
			emito.on("notification:created", listenerA);
			emito.on("notification:created", listenerB);

			await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: {},
			});

			expect(listenerA).toHaveBeenCalledOnce();
			expect(listenerB).toHaveBeenCalledOnce();
		});

		it("should NOT fire when the send goes to a non-inApp channel only", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						email: { providers: [emailProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const listener = vi.fn();
			emito.on("notification:created", listener);

			await emito.send({
				event: "user.promo",
				subscriberId: "sub_1",
				payload: {},
			});

			expect(listener).not.toHaveBeenCalled();
		});

		it("should fire once per send() call (not multiple times per single inApp write)", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						inApp: { providers: [inAppProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const listener = vi.fn();
			emito.on("notification:created", listener);

			await emito.send({
				event: "user.welcome",
				subscriberId: "sub_1",
				payload: {},
			});

			expect(listener).toHaveBeenCalledTimes(1);
		});

		it("should fire multiple times when send() is called multiple times", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						inApp: { providers: [inAppProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const listener = vi.fn();
			emito.on("notification:created", listener);

			await emito.send({ event: "user.welcome", subscriberId: "sub_1", payload: {} });
			await emito.send({ event: "user.welcome", subscriberId: "sub_1", payload: {} });

			expect(listener).toHaveBeenCalledTimes(2);
		});
	});

	// -------------------------------------------------------------------------
	// off() — removes listener
	// -------------------------------------------------------------------------

	describe("off", () => {
		it("should stop calling the listener after off() is called", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						inApp: { providers: [inAppProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const listener = vi.fn();
			emito.on("notification:created", listener);
			emito.off("notification:created", listener);

			await emito.send({ event: "user.welcome", subscriberId: "sub_1", payload: {} });

			expect(listener).not.toHaveBeenCalled();
		});

		it("should only remove the specified listener, leaving others intact", async () => {
			const subscriber = createSubscriberData();
			await repos.subscriberRepository.seed(subscriber);

			const emito = createEmito({
				...createMinimalValidConfig({
					channels: {
						inApp: { providers: [inAppProvider] },
					},
				}),
				repositories: repos,
			});
			await emito.start();

			const listenerA = vi.fn();
			const listenerB = vi.fn();
			emito.on("notification:created", listenerA);
			emito.on("notification:created", listenerB);
			emito.off("notification:created", listenerA);

			await emito.send({ event: "user.welcome", subscriberId: "sub_1", payload: {} });

			expect(listenerA).not.toHaveBeenCalled();
			expect(listenerB).toHaveBeenCalledOnce();
		});
	});
});
