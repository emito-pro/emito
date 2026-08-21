/**
 * DB-backed repository implementations for integration tests.
 *
 * These are test-only wrappers that implement the repository interfaces from
 * @emito/core using real PostgreSQL via Drizzle ORM. They are NOT exported
 * from the @emito/db package — they exist only for integration test verification.
 *
 * Moved from @emito/core/__tests__ to break the circular devDependency cycle.
 */

import type {
	CreateSubscriberData,
	CursorFilter,
	CursorResult,
	RepositoryTx,
	SubscriberEraseCounts,
	SubscriberRepository,
	SubscriptionRecord,
	SubscriptionRepository,
} from "@emito/core";
import type { Subscriber } from "@emito/types";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { emito_subscribers } from "../src/schema/subscribers";
import { emito_subscriptions } from "../src/schema/subscriptions";

type DrizzleDb = ReturnType<typeof drizzle>;

// ---------------------------------------------------------------------------
// DB-backed SubscriberRepository
// ---------------------------------------------------------------------------

export class DbSubscriberRepository implements SubscriberRepository {
	constructor(private readonly db: DrizzleDb) {}

	async findById(id: string): Promise<Subscriber | null> {
		const rows = await this.db
			.select()
			.from(emito_subscribers)
			.where(eq(emito_subscribers.id, id))
			.limit(1);

		const row = rows[0];
		if (!row) return null;

		return {
			id: row.id,
			email: row.email ?? undefined,
			phone: row.phone ?? undefined,
			lang: row.locale ?? undefined,
			timezone: row.timezone ?? undefined,
			globallyUnsubscribed: row.globallyUnsubscribed ?? false,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			erasedAt: row.erasedAt ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	async findByIds(ids: readonly string[]): Promise<Subscriber[]> {
		if (ids.length === 0) return [];
		const rows = await this.db
			.select()
			.from(emito_subscribers)
			.where(inArray(emito_subscribers.id, [...ids]));
		return rows.map((row) => ({
			id: row.id,
			email: row.email ?? undefined,
			phone: row.phone ?? undefined,
			lang: row.locale ?? undefined,
			timezone: row.timezone ?? undefined,
			globallyUnsubscribed: row.globallyUnsubscribed ?? false,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			erasedAt: row.erasedAt ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}));
	}

	async update(
		id: string,
		data: Partial<Omit<Subscriber, "id" | "createdAt">>,
	): Promise<Subscriber> {
		const rows = await this.db
			.update(emito_subscribers)
			.set({
				email: data.email,
				phone: data.phone,
				locale: data.lang,
				timezone: data.timezone,
				globallyUnsubscribed: data.globallyUnsubscribed,
				metadata: data.metadata,
				erasedAt: data.erasedAt,
				updatedAt: new Date(),
			})
			.where(eq(emito_subscribers.id, id))
			.returning();

		const row = rows[0];
		if (!row) throw new Error(`Subscriber not found: ${id}`);

		return {
			id: row.id,
			email: row.email ?? undefined,
			phone: row.phone ?? undefined,
			lang: row.locale ?? undefined,
			timezone: row.timezone ?? undefined,
			globallyUnsubscribed: row.globallyUnsubscribed ?? false,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			erasedAt: row.erasedAt ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	async list(filter?: CursorFilter): Promise<CursorResult<Subscriber>> {
		const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 100);
		const cursorDate = filter?.cursor ? new Date(filter.cursor) : undefined;

		const conditions = [isNull(emito_subscribers.erasedAt)];
		if (cursorDate) conditions.push(lt(emito_subscribers.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_subscribers)
			.where(and(...conditions))
			.orderBy(desc(emito_subscribers.createdAt))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;
		const last = page[page.length - 1];

		return {
			items: page.map((row) => ({
				id: row.id,
				email: row.email ?? undefined,
				phone: row.phone ?? undefined,
				lang: row.lang ?? undefined,
				locale: row.locale ?? undefined,
				timezone: row.timezone ?? undefined,
				globallyUnsubscribed: row.globallyUnsubscribed ?? false,
				metadata: (row.metadata as Record<string, unknown>) ?? {},
				erasedAt: row.erasedAt ?? null,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
			})),
			hasMore,
			cursor: hasMore && last ? last.createdAt.toISOString() : undefined,
		};
	}

	async create(data: CreateSubscriberData): Promise<Subscriber> {
		const rows = await this.db
			.insert(emito_subscribers)
			.values({
				id: data.id,
				email: data.email,
				phone: data.phone,
				lang: data.lang ?? "en",
				locale: data.locale,
				timezone: data.timezone,
				metadata: data.metadata ?? {},
			})
			.returning();

		const row = rows[0];
		if (!row) throw new Error(`Subscriber not created: ${data.id}`);

		return {
			id: row.id,
			email: row.email ?? undefined,
			phone: row.phone ?? undefined,
			lang: row.lang ?? undefined,
			locale: row.locale ?? undefined,
			timezone: row.timezone ?? undefined,
			globallyUnsubscribed: row.globallyUnsubscribed ?? false,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			erasedAt: row.erasedAt ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	async upsert(data: CreateSubscriberData): Promise<Subscriber> {
		const existing = await this.findById(data.id);
		if (!existing) {
			return this.create(data);
		}
		return this.update(data.id, {
			email: data.email ?? existing.email,
			phone: data.phone ?? existing.phone,
			lang: data.lang ?? existing.lang,
			locale: data.locale ?? existing.locale,
			timezone: data.timezone ?? existing.timezone,
			metadata: data.metadata ?? existing.metadata,
		});
	}

	async erase(id: string, _tx?: RepositoryTx): Promise<SubscriberEraseCounts> {
		await this.db
			.update(emito_subscribers)
			.set({
				email: null,
				phone: null,
				metadata: {},
				erasedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(emito_subscribers.id, id));
		// This minimal test helper models only the subscriber + subscription tables,
		// so the cascade collections are not present here — zero is truthful.
		return {
			notifications: 0,
			inboxItems: 0,
			pushTokens: 0,
			personalIntegrations: 0,
			preferences: 0,
			deadLetters: 0,
		};
	}
}

// ---------------------------------------------------------------------------
// DB-backed SubscriptionRepository
// ---------------------------------------------------------------------------

export class DbSubscriptionRepository implements SubscriptionRepository {
	constructor(private readonly db: DrizzleDb) {}

	async findBySubscriberAndTopic(
		subscriberId: string,
		topicId: string,
	): Promise<SubscriptionRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_subscriptions)
			.where(
				and(
					eq(emito_subscriptions.subscriberId, subscriberId),
					eq(emito_subscriptions.topicId, topicId),
				),
			);

		return rows.map((row) => ({
			id: row.id,
			subscriberId: row.subscriberId,
			topicId: row.topicId,
			channel: row.channel as SubscriptionRecord["channel"],
			status: row.status as "opted_in" | "opted_out",
			consentMechanism: row.consentMechanism ?? undefined,
			consentIp: row.consentIp ?? undefined,
			consentAt: row.consentAt ?? undefined,
			updatedAt: row.updatedAt,
		}));
	}
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export interface DbTestContext {
	db: DrizzleDb;
	pgClient: ReturnType<typeof postgres>;
	subscriberRepo: DbSubscriberRepository;
	subscriptionRepo: DbSubscriptionRepository;
}

export function createDbTestContext(uri: string): DbTestContext {
	const pgClient = postgres(uri, { max: 5 });
	const db = drizzle(pgClient, { casing: "snake_case" });

	return {
		db,
		pgClient,
		subscriberRepo: new DbSubscriberRepository(db),
		subscriptionRepo: new DbSubscriptionRepository(db),
	};
}
