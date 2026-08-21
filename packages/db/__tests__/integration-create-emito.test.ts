/**
 * Integration tests for createEmito factory with real PostgreSQL.
 *
 * Verifies that the full send flow works end-to-end against a real database
 * (via Testcontainers). Tests skip gracefully when Docker is unavailable.
 *
 * Moved from @emito/core/__tests__ to break the circular devDependency cycle.
 */

import {
	InMemoryConsentRepository,
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
	type PushTokenRepository,
	createEmito,
	createMockProvider,
} from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { emito_categories } from "../src/schema/categories";
import { emito_subscribers } from "../src/schema/subscribers";
import { emito_subscriptions } from "../src/schema/subscriptions";
import { emito_topics } from "../src/schema/topics";
import { DbSubscriberRepository, DbSubscriptionRepository } from "./db-repositories";

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

type DrizzleDb = ReturnType<typeof drizzle>;

let pgClient: ReturnType<typeof postgres>;
let db: DrizzleDb;
let dbAvailable = false;

let subscriberRepo: DbSubscriberRepository;
let subscriptionRepo: DbSubscriptionRepository;

const CATEGORY_ID = "cat_test_trx";
const MARKETING_CATEGORY_ID = "cat_test_mkt";
// The send pipeline keys subscription lookups on the *event name* (see
// send.ts: `topicKey = params.event`). The marketing send below emits
// "promo.newsletter", so the seeded topic id — and the opted-in subscription's
// topic_id (FK → emito_topics.id) — must equal that event name to be matched.
const TOPIC_ID = "promo.newsletter";

beforeAll(async () => {
	const uri = inject("DB_URI");
	if (!uri) {
		// biome-ignore lint/suspicious/noConsole: integration test skip notification
		console.warn("DB_URI not injected — skipping integration tests.");
		return;
	}

	pgClient = postgres(uri, { max: 3 });
	db = drizzle(pgClient, { casing: "snake_case" });

	await migrate(db, {
		migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
	});

	subscriberRepo = new DbSubscriberRepository(db);
	subscriptionRepo = new DbSubscriptionRepository(db);
	dbAvailable = true;
}, 60_000);

afterAll(async () => {
	if (pgClient) {
		await pgClient.end();
	}
});

/**
 * Seed the categories + topic that send-flow rows reference via FK.
 * The shared per-test TRUNCATE in test-setup.ts wipes every `emito_*` table,
 * so reference data must be re-seeded in beforeEach (after the global truncate),
 * not only once in beforeAll.
 */
async function seedReferenceData(): Promise<void> {
	await db
		.insert(emito_categories)
		.values({
			id: CATEGORY_ID,
			slug: "transactional-integration",
			name: "Transactional",
			legalClass: "exempt",
			defaultPolicy: "always",
		})
		.onConflictDoNothing();

	await db
		.insert(emito_categories)
		.values({
			id: MARKETING_CATEGORY_ID,
			slug: "marketing-integration",
			name: "Marketing",
			legalClass: "consent_required",
			defaultPolicy: "opt_in",
		})
		.onConflictDoNothing();

	await db
		.insert(emito_topics)
		.values({
			id: TOPIC_ID,
			categoryId: MARKETING_CATEGORY_ID,
			slug: "newsletter-integration",
			name: "Newsletter",
		})
		.onConflictDoNothing();
}

beforeEach(async () => {
	if (!dbAvailable) return;
	await seedReferenceData();
});

function skipIfNoDb() {
	return !dbAvailable;
}

// Push tokens are not exercised by these tests — a no-op stub satisfies the
// required PushTokenRepository slot in createEmito's repositories.
const noopPushTokenRepository: PushTokenRepository = {
	async deactivateByToken() {},
};

function createInMemoryRepos() {
	return {
		notificationRepository: new InMemoryNotificationRepository(),
		preferenceRepository: new InMemoryPreferenceRepository(),
		workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
		suppressionRepository: new InMemorySuppressionRepository(),
		deadLetterRepository: new InMemoryDeadLetterRepository(),
		integrationRepository: new InMemoryIntegrationRepository(),
		inboxRepository: new InMemoryInboxRepository(),
		pushTokenRepository: noopPushTokenRepository,
		consentRepository: new InMemoryConsentRepository(),
	};
}

// ---------------------------------------------------------------------------
// Full send flow — DB-backed subscriber repository
// ---------------------------------------------------------------------------

describe("createEmito full send flow (DB-backed)", () => {
	it("should send to a subscriber resolved from real PostgreSQL", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_db_integration_1",
			email: "integration@example.com",
		});

		const emailProvider = createMockProvider("email");

		const emito = createEmito({
			database: { url: "postgresql://localhost:5432/test" },
			redis: { url: "redis://localhost:6379" },
			categories: {
				transactional: { policy: "always" as const },
			},
			events: {
				"user.welcome": {
					category: "transactional",
					channels: ["email" as const],
				},
			},
			channels: {
				email: { providers: [emailProvider] },
			},
			repositories: {
				...createInMemoryRepos(),
				subscriberRepository: subscriberRepo,
				subscriptionRepository: subscriptionRepo,
			},
		});
		await emito.start();

		const result = await emito.send({
			event: "user.welcome",
			subscriberId: "sub_db_integration_1",
			payload: { name: "DB User" },
		});

		expect(result).toMatchObject({
			notificationId: expect.any(String),
			channels: expect.arrayContaining([
				expect.objectContaining({ channel: "email", status: "sent" }),
			]),
		});

		expect(emailProvider.calls).toHaveLength(1);
		expect(emailProvider.calls[0]).toMatchObject({
			channel: "email",
			to: "integration@example.com",
		});
	});

	it("should resolve to SUBSCRIBER_NOT_FOUND for non-existent DB subscriber", async () => {
		if (skipIfNoDb()) return;

		const emailProvider = createMockProvider("email");

		const emito = createEmito({
			database: { url: "postgresql://localhost:5432/test" },
			redis: { url: "redis://localhost:6379" },
			categories: {
				transactional: { policy: "always" as const },
			},
			events: {
				"user.welcome": {
					category: "transactional",
					channels: ["email" as const],
				},
			},
			channels: {
				email: { providers: [emailProvider] },
			},
			repositories: {
				...createInMemoryRepos(),
				subscriberRepository: subscriberRepo,
				subscriptionRepository: subscriptionRepo,
			},
		});
		await emito.start();

		await expect(
			emito.send({
				event: "user.welcome",
				subscriberId: "sub_nonexistent_db",
				payload: {},
			}),
		).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND,
			isRetryable: false,
		});
	});

	it("should block marketing send when no opt-in subscription in DB", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_db_mkt",
			email: "mkt-nooptin@example.com",
		});

		const emailProvider = createMockProvider("email");

		const emito = createEmito({
			database: { url: "postgresql://localhost:5432/test" },
			redis: { url: "redis://localhost:6379" },
			categories: {
				marketing: { policy: "opt_in" as const },
			},
			events: {
				"promo.newsletter": {
					category: "marketing",
					channels: ["email" as const],
				},
			},
			channels: {
				email: { providers: [emailProvider] },
			},
			repositories: {
				...createInMemoryRepos(),
				subscriberRepository: subscriberRepo,
				subscriptionRepository: subscriptionRepo,
			},
		});
		await emito.start();

		await expect(
			emito.send({
				event: "promo.newsletter",
				subscriberId: "sub_db_mkt",
				payload: {},
			}),
		).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.CONSENT_REQUIRED,
			isRetryable: false,
		});

		expect(emailProvider.calls).toHaveLength(0);
	});

	it("should allow marketing send when subscriber has opted-in subscription in DB", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_db_opted_in",
			email: "opted-in@example.com",
		});

		await db.insert(emito_subscriptions).values({
			subscriberId: "sub_db_opted_in",
			topicId: TOPIC_ID,
			channel: "email",
			status: "opted_in",
		});

		const emailProvider = createMockProvider("email");

		const emito = createEmito({
			database: { url: "postgresql://localhost:5432/test" },
			redis: { url: "redis://localhost:6379" },
			categories: {
				marketing: { policy: "opt_in" as const },
			},
			events: {
				"promo.newsletter": {
					category: "marketing",
					channels: ["email" as const],
				},
			},
			channels: {
				email: { providers: [emailProvider] },
			},
			repositories: {
				...createInMemoryRepos(),
				subscriberRepository: subscriberRepo,
				subscriptionRepository: subscriptionRepo,
			},
		});
		await emito.start();

		const result = await emito.send({
			event: "promo.newsletter",
			subscriberId: "sub_db_opted_in",
			payload: {},
		});

		expect(result.channels).toEqual(
			expect.arrayContaining([expect.objectContaining({ channel: "email", status: "sent" })]),
		);
	});

	it("should block erased subscriber from all sends (DB-backed)", async () => {
		if (skipIfNoDb()) return;

		const erasedAt = new Date("2026-01-01T00:00:00Z");

		await db.insert(emito_subscribers).values({
			id: "sub_erased_db",
			email: "anon@redacted.emito.local",
			erasedAt,
		});

		const emailProvider = createMockProvider("email");

		const emito = createEmito({
			database: { url: "postgresql://localhost:5432/test" },
			redis: { url: "redis://localhost:6379" },
			categories: {
				transactional: { policy: "always" as const },
			},
			events: {
				"user.welcome": {
					category: "transactional",
					channels: ["email" as const],
				},
			},
			channels: {
				email: { providers: [emailProvider] },
			},
			repositories: {
				...createInMemoryRepos(),
				subscriberRepository: subscriberRepo,
				subscriptionRepository: subscriptionRepo,
			},
		});
		await emito.start();

		await expect(
			emito.send({
				event: "user.welcome",
				subscriberId: "sub_erased_db",
				payload: {},
			}),
		).rejects.toMatchObject({
			code: EMITO_ERROR_CODE.SUBSCRIBER_ERASED,
			isRetryable: false,
		});

		expect(emailProvider.calls).toHaveLength(0);
	});

	it("should use recipient override email instead of DB subscriber email", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_db_override",
			email: "original@example.com",
		});

		const emailProvider = createMockProvider("email");

		const emito = createEmito({
			database: { url: "postgresql://localhost:5432/test" },
			redis: { url: "redis://localhost:6379" },
			categories: {
				transactional: { policy: "always" as const },
			},
			events: {
				"user.welcome": {
					category: "transactional",
					channels: ["email" as const],
				},
			},
			channels: {
				email: { providers: [emailProvider] },
			},
			repositories: {
				...createInMemoryRepos(),
				subscriberRepository: subscriberRepo,
				subscriptionRepository: subscriptionRepo,
			},
		});
		await emito.start();

		await emito.send({
			event: "user.welcome",
			subscriberId: "sub_db_override",
			recipient: { email: "override@example.com" },
			payload: {},
		});

		expect(emailProvider.calls[0]).toMatchObject({
			to: "override@example.com",
		});
	});
});
