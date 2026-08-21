/**
 * Integration tests for core modules using real PostgreSQL via Testcontainers.
 *
 * Verifies that the event registry, category enforcement, and subscriber
 * resolver behave correctly when wired to DB-backed repositories.
 *
 * Tests are skipped gracefully when Docker is unavailable.
 *
 * Moved from @emito/core/__tests__ to break the circular devDependency cycle.
 */

import {
	InMemoryConsentRepository,
	createEventRegistry,
	enforceCategory,
	resolveSubscriber,
} from "@emito/core";
import { EMITO_ERROR_CODE, type EmitoError } from "@emito/types";
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
const consentRepo = new InMemoryConsentRepository();

// Seeded reference IDs
const CATEGORY_ID = "cat_test_transactional";
const TOPIC_ID = "top_test_newsletter";

beforeAll(async () => {
	const uri = inject("DB_URI");
	if (!uri) {
		console.warn("DB_URI not injected — skipping integration tests.");
		return;
	}

	pgClient = postgres(uri, { max: 3 });
	db = drizzle(pgClient, { casing: "snake_case" });

	// Run all migrations from the @emito/db package
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
 * Seed the category + topic that subscription rows reference via FK.
 * The shared per-test TRUNCATE in test-setup.ts wipes every `emito_*` table
 * (including these reference rows), so seeding must happen in beforeEach —
 * which runs after the global truncate — not just once in beforeAll.
 */
async function seedReferenceData(): Promise<void> {
	await db
		.insert(emito_categories)
		.values({
			id: CATEGORY_ID,
			slug: "transactional-test",
			name: "Transactional",
			legalClass: "exempt",
			defaultPolicy: "always",
		})
		.onConflictDoNothing();

	await db
		.insert(emito_topics)
		.values({
			id: TOPIC_ID,
			categoryId: CATEGORY_ID,
			slug: "newsletter-test",
			name: "Newsletter",
		})
		.onConflictDoNothing();
}

beforeEach(async () => {
	if (!dbAvailable) return;
	await seedReferenceData();
});

function skipIfNoDb() {
	if (!dbAvailable) {
		return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Event Registry — DB-independent, but verify same behavior as unit tests
// ---------------------------------------------------------------------------

describe("EventRegistry (DB context)", () => {
	it("resolves events from config (no DB dependency)", () => {
		const registry = createEventRegistry({
			"order.confirmed": { category: "transactional", channels: ["email"] },
		});

		const event = registry.getEvent("order.confirmed");

		expect(event).toMatchObject({ category: "transactional", channels: ["email"] });
	});

	it("throws CONFIG_INVALID with isRetryable: false for unknown event", () => {
		const registry = createEventRegistry({
			"order.confirmed": { category: "transactional", channels: ["email"] },
		});

		try {
			registry.getEvent("order.shipped" as "order.confirmed");
		} catch (err) {
			const error = err as EmitoError;
			expect(error.code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
			expect(error.isRetryable).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// Subscriber Resolver — DB-backed
// ---------------------------------------------------------------------------

describe("resolveSubscriber (DB-backed)", () => {
	it("resolves subscriber from real PostgreSQL", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_db_1",
			email: "dbtest@example.com",
		});

		const result = await resolveSubscriber("sub_db_1", undefined, {
			subscriberRepository: subscriberRepo,
		});

		expect(result.subscriber).toMatchObject({
			id: "sub_db_1",
			email: "dbtest@example.com",
		});
		expect(result.overridden).toBe(false);
	});

	it("merges recipient overrides with DB subscriber", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_db_2",
			email: "original@example.com",
		});

		const result = await resolveSubscriber(
			"sub_db_2",
			{ email: "override@example.com" },
			{ subscriberRepository: subscriberRepo },
		);

		expect(result.subscriber.email).toBe("override@example.com");
		expect(result.overridden).toBe(true);
	});

	it("throws SUBSCRIBER_NOT_FOUND when subscriber absent from DB and no overrides", async () => {
		if (skipIfNoDb()) return;

		try {
			await resolveSubscriber("sub_nonexistent", undefined, {
				subscriberRepository: subscriberRepo,
			});
			expect.fail("Should have thrown");
		} catch (err) {
			const error = err as EmitoError;
			expect(error.code).toBe(EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND);
			expect(error.isRetryable).toBe(false);
		}
	});

	it("creates minimal subscriber from overrides when not in DB", async () => {
		if (skipIfNoDb()) return;

		const result = await resolveSubscriber(
			"sub_not_in_db",
			{ email: "guest@example.com" },
			{ subscriberRepository: subscriberRepo },
		);

		expect(result.subscriber.id).toBe("sub_not_in_db");
		expect(result.subscriber.email).toBe("guest@example.com");
		expect(result.overridden).toBe(true);
	});

	it("preserves erasedAt from DB subscriber", async () => {
		if (skipIfNoDb()) return;

		const erasedAt = new Date("2026-01-15T00:00:00Z");

		await db.insert(emito_subscribers).values({
			id: "sub_erased",
			email: "erased@example.com",
			erasedAt,
		});

		const result = await resolveSubscriber("sub_erased", undefined, {
			subscriberRepository: subscriberRepo,
		});

		expect(result.subscriber.erasedAt).toEqual(erasedAt);
	});
});

// ---------------------------------------------------------------------------
// Category Enforcement — DB-backed subscriptions
// ---------------------------------------------------------------------------

describe("enforceCategory (DB-backed)", () => {
	it("allows transactional for active subscriber (no DB subscription needed)", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_trx_1",
			email: "trx@example.com",
		});

		const subscriber = {
			id: "sub_trx_1",
			email: "trx@example.com",
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await expect(
			enforceCategory(subscriber, { policy: "always" }, "transactional", "password-reset", {
				subscriptionRepository: subscriptionRepo,
				consentRepository: consentRepo,
			}),
		).resolves.toBeUndefined();
	});

	it("throws SUBSCRIBER_ERASED for subscriber with erasedAt set", async () => {
		if (skipIfNoDb()) return;

		const subscriber = {
			id: "sub_erased_enf",
			email: "anon@redacted.emito.local",
			erasedAt: new Date("2026-01-01"),
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		try {
			await enforceCategory(subscriber, { policy: "always" }, "transactional", "password-reset", {
				subscriptionRepository: subscriptionRepo,
				consentRepository: consentRepo,
			});
			expect.fail("Should have thrown");
		} catch (err) {
			const error = err as EmitoError;
			expect(error.code).toBe(EMITO_ERROR_CODE.SUBSCRIBER_ERASED);
			expect(error.isRetryable).toBe(false);
		}
	});

	it("throws CONSENT_REQUIRED for marketing when no DB subscription exists", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_mkt_1",
			email: "mkt@example.com",
		});

		const subscriber = {
			id: "sub_mkt_1",
			email: "mkt@example.com",
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		try {
			await enforceCategory(subscriber, { policy: "opt_in" }, "marketing", TOPIC_ID, {
				subscriptionRepository: subscriptionRepo,
				consentRepository: consentRepo,
			});
			expect.fail("Should have thrown");
		} catch (err) {
			const error = err as EmitoError;
			expect(error.code).toBe(EMITO_ERROR_CODE.CONSENT_REQUIRED);
			expect(error.isRetryable).toBe(false);
		}
	});

	it("allows marketing when subscriber has opted-in subscription in DB", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_mkt_2",
			email: "opted-in@example.com",
		});

		await db.insert(emito_subscriptions).values({
			subscriberId: "sub_mkt_2",
			topicId: TOPIC_ID,
			channel: "email",
			status: "opted_in",
		});

		const subscriber = {
			id: "sub_mkt_2",
			email: "opted-in@example.com",
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await expect(
			enforceCategory(subscriber, { policy: "opt_in" }, "marketing", TOPIC_ID, {
				subscriptionRepository: subscriptionRepo,
				consentRepository: consentRepo,
			}),
		).resolves.toBeUndefined();
	});

	it("throws CATEGORY_BLOCKED for product when subscriber has opted out in DB", async () => {
		if (skipIfNoDb()) return;

		await db.insert(emito_subscribers).values({
			id: "sub_prd_1",
			email: "optedout@example.com",
		});

		await db.insert(emito_subscriptions).values({
			subscriberId: "sub_prd_1",
			topicId: TOPIC_ID,
			channel: "email",
			status: "opted_out",
		});

		const subscriber = {
			id: "sub_prd_1",
			email: "optedout@example.com",
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		try {
			await enforceCategory(subscriber, { policy: "opt_out" }, "product", TOPIC_ID, {
				subscriptionRepository: subscriptionRepo,
				consentRepository: consentRepo,
			});
			expect.fail("Should have thrown");
		} catch (err) {
			const error = err as EmitoError;
			expect(error.code).toBe(EMITO_ERROR_CODE.CATEGORY_BLOCKED);
			expect(error.isRetryable).toBe(false);
		}
	});
});
