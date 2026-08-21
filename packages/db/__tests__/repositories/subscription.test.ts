/**
 * Integration tests for the {@link DrizzleSubscriptionRepository} against a real
 * PostgreSQL, plus a barrel-export regression guard for the two newest Drizzle
 * repositories (F1).
 *
 * `emito_subscriptions` has NOT-NULL FKs to `emito_subscribers` and `emito_topics`
 * (which itself has a NOT-NULL FK to `emito_categories`), so each row needs a
 * seeded category -> topic -> subscriber chain before the subscription insert.
 *
 * @module __tests__/repositories/subscription
 */
import { describe, expect, it } from "vitest";
import { DrizzlePushTokenRepository, DrizzleSubscriptionRepository } from "../../src/index";
import { emito_categories } from "../../src/schema/categories";
import { emito_subscribers } from "../../src/schema/subscribers";
import { emito_subscriptions } from "../../src/schema/subscriptions";
import { emito_topics } from "../../src/schema/topics";
import { dbAvailable, getDb, setupAdminTestDb } from "./admin-test-db";

setupAdminTestDb();

describe("DrizzleSubscriptionRepository", () => {
	it("finds subscriptions by subscriber + topic", async () => {
		if (!dbAvailable()) return;
		const db = getDb();

		const [category] = await db
			.insert(emito_categories)
			.values({
				slug: "cat-1",
				name: "Category 1",
				legalClass: "marketing",
				defaultPolicy: "opt_in",
			})
			.returning({ id: emito_categories.id });
		if (!category) throw new Error("failed to seed category");

		await db.insert(emito_subscribers).values({ id: "sub_1" });
		await db
			.insert(emito_topics)
			.values({ id: "top_1", categoryId: category.id, slug: "top-1", name: "Topic 1" });
		await db
			.insert(emito_subscriptions)
			.values({ subscriberId: "sub_1", topicId: "top_1", channel: "email", status: "opted_out" });

		const repo = new DrizzleSubscriptionRepository(db);
		const rows = await repo.findBySubscriberAndTopic("sub_1", "top_1");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ channel: "email", status: "opted_out" });
	});

	it("barrel exports both new repos", () => {
		expect(typeof DrizzleSubscriptionRepository).toBe("function");
		expect(typeof DrizzlePushTokenRepository).toBe("function");
	});
});
