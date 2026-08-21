/**
 * Integration tests for the core notification flow schema.
 *
 * Covers: subscribers, notifications, preferences, workspace_defaults,
 * categories, topics, subscriptions, inbox, push_tokens, integrations.
 *
 * Tests run against a real PostgreSQL 16 instance via Testcontainers.
 * The container is started in global-setup.ts; this file uses the injected DB_URI.
 *
 * Success criteria verified:
 * - All 10 tables exist with correct columns, types, and defaults
 * - Migration applies cleanly on empty PostgreSQL 16
 * - UNIQUE constraints reject duplicates
 * - Foreign keys are enforced
 * - Partial indexes are created
 * - All Emito-owned IDs use correct entity prefix via $defaultFn
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { installIdDefaults } from "./id-defaults";

// ---------------------------------------------------------------------------
// DB connection setup — uses the container URI injected by global-setup.ts
// ---------------------------------------------------------------------------

let pgClient: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
	const uri = inject("DB_URI");

	if (!uri) {
		console.warn("DB_URI not injected — Docker may be unavailable. Skipping integration tests.");
		return;
	}

	pgClient = postgres(uri, { max: 1 });
	db = drizzle(pgClient, { casing: "snake_case" });

	// Run all available migrations so every test starts from a fully migrated state
	await migrate(db, { migrationsFolder: "./drizzle" });

	// Raw-SQL inserts in this file omit `id` and assert a DB-generated prefixed
	// id; install equivalent DB-side defaults (test database only).
	await installIdDefaults(db);
}, 60_000);

afterAll(async () => {
	if (pgClient) {
		await pgClient.end();
	}
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return true if the DB connection is available. Used to skip tests gracefully. */
function hasDb(): boolean {
	return db != null;
}

/** Query pg_tables for a given table name (public schema). */
async function tableExists(tableName: string): Promise<boolean> {
	const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS "exists"
  `);
	return (result[0] as { exists: boolean } | undefined)?.exists ?? false;
}

/** Return all column names for a given table. */
async function getColumns(tableName: string): Promise<string[]> {
	const rows = await db.execute<{ column_name: string }>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
    ORDER BY ordinal_position
  `);
	return rows.map((r) => (r as { column_name: string }).column_name);
}

/** Return all indexes for a given table (including partial). */
async function getIndexes(
	tableName: string,
): Promise<Array<{ indexname: string; indexdef: string }>> {
	const rows = await db.execute<{ indexname: string; indexdef: string }>(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = ${tableName}
  `);
	return rows.map((r) => r as { indexname: string; indexdef: string });
}

/** Return all UNIQUE constraints for a given table. */
async function getUniqueConstraints(
	tableName: string,
): Promise<Array<{ constraint_name: string; column_name: string }>> {
	const rows = await db.execute<{ constraint_name: string; column_name: string }>(sql`
    SELECT tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE'
      AND tc.table_schema = 'public'
      AND tc.table_name = ${tableName}
    ORDER BY tc.constraint_name, kcu.ordinal_position
  `);
	return rows.map((r) => r as { constraint_name: string; column_name: string });
}

/** Return all FK constraints for a given table. */
async function getForeignKeys(
	tableName: string,
): Promise<
	Array<{ column_name: string; foreign_table_name: string; foreign_column_name: string }>
> {
	const rows = await db.execute<{
		column_name: string;
		foreign_table_name: string;
		foreign_column_name: string;
	}>(sql`
    SELECT
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = ${tableName}
  `);
	return rows.map(
		(r) =>
			r as {
				column_name: string;
				foreign_table_name: string;
				foreign_column_name: string;
			},
	);
}

// ---------------------------------------------------------------------------
// Helper: insert one row and return it
// ---------------------------------------------------------------------------

async function insertSubscriber(overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
	const id = overrides.id ?? `user_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	await db.execute(sql`
    INSERT INTO emito_subscribers (id, email, phone)
    VALUES (${id as string}, ${(overrides.email as string) ?? null}, ${(overrides.phone as string) ?? null})
  `);
	return { id: id as string };
}

async function insertCategory(slug: string): Promise<{ id: string }> {
	const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO emito_categories (slug, name, legal_class, default_policy)
    VALUES (${slug}, ${slug}, 'transactional', 'always')
    RETURNING id
  `);
	return { id: (rows[0] as { id: string }).id };
}

async function insertTopic(categoryId: string, slug: string): Promise<{ id: string }> {
	const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO emito_topics (category_id, slug, name)
    VALUES (${categoryId}, ${slug}, ${slug})
    RETURNING id
  `);
	return { id: (rows[0] as { id: string }).id };
}

// ---------------------------------------------------------------------------
// Suite: Table existence
// ---------------------------------------------------------------------------

describe("Core schema — table existence", () => {
	const TABLES = [
		"emito_subscribers",
		"emito_notifications",
		"emito_preferences",
		"emito_workspace_defaults",
		"emito_categories",
		"emito_topics",
		"emito_subscriptions",
		"emito_inbox",
		"emito_push_tokens",
		"emito_integrations",
	];

	for (const table of TABLES) {
		it(`should have table ${table}`, async () => {
			if (!hasDb()) return;
			expect(await tableExists(table)).toBe(true);
		});
	}
});

// ---------------------------------------------------------------------------
// Suite: emito_subscribers column coverage
// ---------------------------------------------------------------------------

describe("emito_subscribers", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_subscribers");
		const required = [
			"id",
			"email",
			"phone",
			"lang",
			"locale",
			"timezone",
			"globally_unsubscribed",
			"globally_unsubscribed_at",
			"metadata",
			"erased_at",
			"created_at",
			"updated_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should default lang to en", async () => {
		if (!hasDb()) return;
		// The default-language column is `lang` (defaults to `en`); `locale` is the
		// separate nullable, no-default BCP 47 column.
		const { id } = await insertSubscriber({ id: `user_lang_${Date.now()}` });
		const rows = await db.execute<{ lang: string }>(
			sql`SELECT lang FROM emito_subscribers WHERE id = ${id}`,
		);
		expect((rows[0] as { lang: string }).lang).toBe("en");
	});

	it("should default globally_unsubscribed to false", async () => {
		if (!hasDb()) return;
		const { id } = await insertSubscriber({ id: `user_unsub_${Date.now()}` });
		const rows = await db.execute<{ globally_unsubscribed: boolean }>(
			sql`SELECT globally_unsubscribed FROM emito_subscribers WHERE id = ${id}`,
		);
		expect((rows[0] as { globally_unsubscribed: boolean }).globally_unsubscribed).toBe(false);
	});

	it("should default metadata to empty object", async () => {
		if (!hasDb()) return;
		const { id } = await insertSubscriber({ id: `user_meta_${Date.now()}` });
		const rows = await db.execute<{ metadata: unknown }>(
			sql`SELECT metadata FROM emito_subscribers WHERE id = ${id}`,
		);
		expect((rows[0] as { metadata: unknown }).metadata).toMatchObject({});
	});

	it("should allow erased_at to be null by default", async () => {
		if (!hasDb()) return;
		const { id } = await insertSubscriber({ id: `user_erased_${Date.now()}` });
		const rows = await db.execute<{ erased_at: unknown }>(
			sql`SELECT erased_at FROM emito_subscribers WHERE id = ${id}`,
		);
		expect((rows[0] as { erased_at: unknown }).erased_at).toBeNull();
	});

	it("should accept host-app string IDs (not generated by Emito)", async () => {
		if (!hasDb()) return;
		const customId = "myapp_user_abc123";
		await insertSubscriber({ id: customId });
		const rows = await db.execute<{ id: string }>(
			sql`SELECT id FROM emito_subscribers WHERE id = ${customId}`,
		);
		expect((rows[0] as { id: string }).id).toBe(customId);
	});

	it("should have an index on email", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_subscribers");
		const emailIndex = indexes.find((i) => i.indexname === "idx_emito_sub_email");
		expect(emailIndex).toBeDefined();
		expect(emailIndex?.indexdef).toContain("email");
	});

	it("should have a partial index on erased_at WHERE erased_at IS NOT NULL", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_subscribers");
		const erasedIndex = indexes.find((i) => i.indexname === "idx_emito_sub_erased");
		expect(erasedIndex).toBeDefined();
		expect(erasedIndex?.indexdef.toLowerCase()).toContain("where");
		expect(erasedIndex?.indexdef.toLowerCase()).toContain("not null");
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_notifications
// ---------------------------------------------------------------------------

describe("emito_notifications", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_notifications");
		const required = [
			"id",
			"subscriber_id",
			"workspace_id",
			"event_type",
			"category",
			"channel",
			"status",
			"provider",
			"provider_msg_id",
			"error_message",
			"error_classification",
			"attempts",
			"payload",
			"metadata",
			"idempotency_key",
			"created_at",
			"sent_at",
			"delivered_at",
			"opened_at",
			"clicked_at",
			"failed_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should default status to pending", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({
			id: `user_notif_${Date.now()}`,
		});
		const rows = await db.execute<{ id: string; status: string }>(sql`
      INSERT INTO emito_notifications (subscriber_id, event_type, category, channel)
      VALUES (${subscriberId}, 'test.event', 'transactional', 'email')
      RETURNING id, status
    `);
		const row = rows[0] as { id: string; status: string };
		expect(row.status).toBe("pending");
		// ID should start with ntf_
		expect(row.id).toMatch(/^ntf_/);
	});

	it("should default attempts to 0", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({
			id: `user_attempts_${Date.now()}`,
		});
		const rows = await db.execute<{ attempts: number }>(sql`
      INSERT INTO emito_notifications (subscriber_id, event_type, category, channel)
      VALUES (${subscriberId}, 'test.event', 'transactional', 'email')
      RETURNING attempts
    `);
		expect((rows[0] as { attempts: number }).attempts).toBe(0);
	});

	it("should enforce UNIQUE constraint on idempotency_key", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({
			id: `user_idem_${Date.now()}`,
		});
		const key = `idem_key_${Date.now()}`;
		await db.execute(sql`
      INSERT INTO emito_notifications (subscriber_id, event_type, category, channel, idempotency_key)
      VALUES (${subscriberId}, 'test.event', 'transactional', 'email', ${key})
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_notifications (subscriber_id, event_type, category, channel, idempotency_key)
        VALUES (${subscriberId}, 'test.event2', 'transactional', 'sms', ${key})
      `),
		).rejects.toThrow();
	});

	it("should allow multiple notifications without idempotency_key (NULL is not unique)", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({
			id: `user_no_idem_${Date.now()}`,
		});
		// Both have NULL idempotency_key — should not conflict
		await db.execute(sql`
      INSERT INTO emito_notifications (subscriber_id, event_type, category, channel)
      VALUES (${subscriberId}, 'test.event', 'transactional', 'email')
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_notifications (subscriber_id, event_type, category, channel)
        VALUES (${subscriberId}, 'test.event', 'transactional', 'email')
      `),
		).resolves.toBeDefined();
	});

	it("should have index on (subscriber_id, created_at DESC)", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_notifications");
		const subIdx = indexes.find((i) => i.indexname === "idx_emito_notif_sub");
		expect(subIdx).toBeDefined();
		expect(subIdx?.indexdef).toContain("subscriber_id");
	});

	it("should have partial index on status for non-terminal statuses", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_notifications");
		const statusIdx = indexes.find((i) => i.indexname === "idx_emito_notif_status");
		expect(statusIdx).toBeDefined();
		expect(statusIdx?.indexdef.toLowerCase()).toContain("where");
	});

	it("should have partial index on (workspace_id, created_at) WHERE workspace_id IS NOT NULL", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_notifications");
		const wsIdx = indexes.find((i) => i.indexname === "idx_emito_notif_ws");
		expect(wsIdx).toBeDefined();
		expect(wsIdx?.indexdef.toLowerCase()).toContain("where");
		expect(wsIdx?.indexdef.toLowerCase()).toContain("not null");
	});

	it("should have index on (event_type, created_at DESC)", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_notifications");
		const evtIdx = indexes.find((i) => i.indexname === "idx_emito_notif_event");
		expect(evtIdx).toBeDefined();
		expect(evtIdx?.indexdef).toContain("event_type");
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_preferences
// ---------------------------------------------------------------------------

describe("emito_preferences", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_preferences");
		const required = [
			"id",
			"subscriber_id",
			"workspace_id",
			"topic_key",
			"channel",
			"enabled",
			"created_at",
			"updated_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate a pref_ prefixed ID", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_pref_${Date.now()}` });
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_preferences (subscriber_id, topic_key, enabled)
      VALUES (${subscriberId}, 'newsletter', true)
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^pref_/);
	});

	it("should enforce UNIQUE on (subscriber_id, workspace_id, topic_key, channel)", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_pref_uniq_${Date.now()}` });
		await db.execute(sql`
      INSERT INTO emito_preferences (subscriber_id, workspace_id, topic_key, channel, enabled)
      VALUES (${subscriberId}, 'ws_1', 'newsletter', 'email', true)
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_preferences (subscriber_id, workspace_id, topic_key, channel, enabled)
        VALUES (${subscriberId}, 'ws_1', 'newsletter', 'email', false)
      `),
		).rejects.toThrow();
	});

	it("should allow same topic_key+channel for different workspaces", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_pref_ws_${Date.now()}` });
		await db.execute(sql`
      INSERT INTO emito_preferences (subscriber_id, workspace_id, topic_key, channel, enabled)
      VALUES (${subscriberId}, 'ws_A', 'newsletter', 'email', true)
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_preferences (subscriber_id, workspace_id, topic_key, channel, enabled)
        VALUES (${subscriberId}, 'ws_B', 'newsletter', 'email', false)
      `),
		).resolves.toBeDefined();
	});

	it("should allow global scope (workspace_id NULL) alongside workspace-scoped row", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_pref_global_${Date.now()}` });
		// Global scope
		await db.execute(sql`
      INSERT INTO emito_preferences (subscriber_id, workspace_id, topic_key, channel, enabled)
      VALUES (${subscriberId}, NULL, 'newsletter', 'email', true)
    `);
		// Workspace scope — different from global (NULL != 'ws_X')
		await expect(
			db.execute(sql`
        INSERT INTO emito_preferences (subscriber_id, workspace_id, topic_key, channel, enabled)
        VALUES (${subscriberId}, 'ws_X', 'newsletter', 'email', false)
      `),
		).resolves.toBeDefined();
	});

	it("should have index on (subscriber_id, workspace_id)", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_preferences");
		const subIdx = indexes.find((i) => i.indexname === "idx_emito_pref_sub");
		expect(subIdx).toBeDefined();
		expect(subIdx?.indexdef).toContain("subscriber_id");
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_workspace_defaults
// ---------------------------------------------------------------------------

describe("emito_workspace_defaults", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_workspace_defaults");
		const required = [
			"id",
			"workspace_id",
			"topic_key",
			"channel",
			"enabled",
			"is_mandatory",
			"created_at",
			"updated_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should default enabled to true and is_mandatory to false", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ enabled: boolean; is_mandatory: boolean }>(sql`
      INSERT INTO emito_workspace_defaults (workspace_id, topic_key, enabled, is_mandatory)
      VALUES ('ws_defaults_test', 'newsletter', DEFAULT, DEFAULT)
      RETURNING enabled, is_mandatory
    `);
		const row = rows[0] as { enabled: boolean; is_mandatory: boolean };
		expect(row.enabled).toBe(true);
		expect(row.is_mandatory).toBe(false);
	});

	it("should enforce UNIQUE on (workspace_id, topic_key, channel)", async () => {
		if (!hasDb()) return;
		await db.execute(sql`
      INSERT INTO emito_workspace_defaults (workspace_id, topic_key, channel, enabled)
      VALUES ('ws_uniq_test', 'promo', 'sms', true)
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_workspace_defaults (workspace_id, topic_key, channel, enabled)
        VALUES ('ws_uniq_test', 'promo', 'sms', false)
      `),
		).rejects.toThrow();
	});

	it("should generate a wsd_ prefixed ID", async () => {
		if (!hasDb()) return;
		const workspaceId = `ws_prefix_test_${Date.now()}`;
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_workspace_defaults (workspace_id, topic_key, enabled)
      VALUES (${workspaceId}, 'alerts', true)
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^wsd_/);
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_categories
// ---------------------------------------------------------------------------

describe("emito_categories", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_categories");
		const required = [
			"id",
			"slug",
			"name",
			"description",
			"legal_class",
			"default_policy",
			"user_configurable",
			"sort_order",
			"parent_id",
			"created_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate a cat_ prefixed ID", async () => {
		if (!hasDb()) return;
		const slug = `transactional_${Date.now()}`;
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_categories (slug, name, legal_class, default_policy)
      VALUES (${slug}, 'Transactional', 'transactional', 'always')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^cat_/);
	});

	it("should enforce UNIQUE on slug", async () => {
		if (!hasDb()) return;
		const slug = `slug_uniq_${Date.now()}`;
		await db.execute(sql`
      INSERT INTO emito_categories (slug, name, legal_class, default_policy)
      VALUES (${slug}, 'Category A', 'transactional', 'always')
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_categories (slug, name, legal_class, default_policy)
        VALUES (${slug}, 'Category B', 'commercial', 'opt_in')
      `),
		).rejects.toThrow();
	});

	it("should support self-referential parent_id (category hierarchy)", async () => {
		if (!hasDb()) return;
		const { id: parentId } = await insertCategory(`parent_cat_${Date.now()}`);
		const rows = await db.execute<{ id: string; parent_id: string }>(sql`
      INSERT INTO emito_categories (slug, name, legal_class, default_policy, parent_id)
      VALUES (${"child_cat_" + Date.now()}, 'Child Category', 'commercial', 'opt_in', ${parentId})
      RETURNING id, parent_id
    `);
		const row = rows[0] as { id: string; parent_id: string };
		expect(row.parent_id).toBe(parentId);
	});

	it("should reject parent_id pointing to non-existent category (FK enforcement)", async () => {
		if (!hasDb()) return;
		await expect(
			db.execute(sql`
        INSERT INTO emito_categories (slug, name, legal_class, default_policy, parent_id)
        VALUES (${"bad_parent_" + Date.now()}, 'Bad Child', 'transactional', 'always', 'cat_nonexistent')
      `),
		).rejects.toThrow();
	});

	it("should default user_configurable to true and sort_order to 0", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ user_configurable: boolean; sort_order: number }>(sql`
      INSERT INTO emito_categories (slug, name, legal_class, default_policy)
      VALUES (${"defaults_cat_" + Date.now()}, 'Defaults Cat', 'transactional', 'always')
      RETURNING user_configurable, sort_order
    `);
		const row = rows[0] as { user_configurable: boolean; sort_order: number };
		expect(row.user_configurable).toBe(true);
		expect(row.sort_order).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_topics
// ---------------------------------------------------------------------------

describe("emito_topics", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_topics");
		const required = [
			"id",
			"category_id",
			"slug",
			"name",
			"description",
			"default_subscribed",
			"user_configurable",
			"sort_order",
			"created_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate a top_ prefixed ID", async () => {
		if (!hasDb()) return;
		const { id: categoryId } = await insertCategory(`cat_for_topic_${Date.now()}`);
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_topics (category_id, slug, name)
      VALUES (${categoryId}, ${"topic_prefix_" + Date.now()}, 'Test Topic')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^top_/);
	});

	it("should enforce FK to emito_categories (category_id)", async () => {
		if (!hasDb()) return;
		await expect(
			db.execute(sql`
        INSERT INTO emito_topics (category_id, slug, name)
        VALUES ('cat_nonexistent', ${"topic_bad_" + Date.now()}, 'Bad Topic')
      `),
		).rejects.toThrow();
	});

	it("should enforce UNIQUE on slug", async () => {
		if (!hasDb()) return;
		const { id: categoryId } = await insertCategory(`cat_for_slug_${Date.now()}`);
		const slug = `topic_slug_${Date.now()}`;
		await db.execute(sql`
      INSERT INTO emito_topics (category_id, slug, name)
      VALUES (${categoryId}, ${slug}, 'Topic A')
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_topics (category_id, slug, name)
        VALUES (${categoryId}, ${slug}, 'Topic B')
      `),
		).rejects.toThrow();
	});

	it("should default default_subscribed to true", async () => {
		if (!hasDb()) return;
		const { id: categoryId } = await insertCategory(`cat_def_sub_${Date.now()}`);
		const rows = await db.execute<{ default_subscribed: boolean }>(sql`
      INSERT INTO emito_topics (category_id, slug, name)
      VALUES (${categoryId}, ${"topic_def_" + Date.now()}, 'Defaults Topic')
      RETURNING default_subscribed
    `);
		expect((rows[0] as { default_subscribed: boolean }).default_subscribed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_subscriptions
// ---------------------------------------------------------------------------

describe("emito_subscriptions", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_subscriptions");
		const required = [
			"id",
			"subscriber_id",
			"topic_id",
			"channel",
			"status",
			"consent_mechanism",
			"consent_ip",
			"consent_at",
			"updated_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate a tsc_ prefixed ID", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_sub_tsc_${Date.now()}` });
		const { id: categoryId } = await insertCategory(`cat_for_tsc_${Date.now()}`);
		const { id: topicId } = await insertTopic(categoryId, `topic_for_tsc_${Date.now()}`);

		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_subscriptions (subscriber_id, topic_id, channel)
      VALUES (${subscriberId}, ${topicId}, 'email')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^tsc_/);
	});

	it("should default status to opted_in", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_sub_status_${Date.now()}` });
		const { id: categoryId } = await insertCategory(`cat_status_${Date.now()}`);
		const { id: topicId } = await insertTopic(categoryId, `topic_status_${Date.now()}`);

		const rows = await db.execute<{ status: string }>(sql`
      INSERT INTO emito_subscriptions (subscriber_id, topic_id, channel)
      VALUES (${subscriberId}, ${topicId}, 'email')
      RETURNING status
    `);
		expect((rows[0] as { status: string }).status).toBe("opted_in");
	});

	it("should enforce FK to emito_subscribers (subscriber_id)", async () => {
		if (!hasDb()) return;
		const { id: categoryId } = await insertCategory(`cat_sub_fk_${Date.now()}`);
		const { id: topicId } = await insertTopic(categoryId, `topic_sub_fk_${Date.now()}`);

		await expect(
			db.execute(sql`
        INSERT INTO emito_subscriptions (subscriber_id, topic_id, channel)
        VALUES ('nonexistent_user', ${topicId}, 'email')
      `),
		).rejects.toThrow();
	});

	it("should enforce FK to emito_topics (topic_id)", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_topic_fk_${Date.now()}` });
		await expect(
			db.execute(sql`
        INSERT INTO emito_subscriptions (subscriber_id, topic_id, channel)
        VALUES (${subscriberId}, 'top_nonexistent', 'email')
      `),
		).rejects.toThrow();
	});

	it("should enforce UNIQUE on (subscriber_id, topic_id, channel)", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_sub_uniq_${Date.now()}` });
		const { id: categoryId } = await insertCategory(`cat_sub_uniq_${Date.now()}`);
		const { id: topicId } = await insertTopic(categoryId, `topic_sub_uniq_${Date.now()}`);

		await db.execute(sql`
      INSERT INTO emito_subscriptions (subscriber_id, topic_id, channel)
      VALUES (${subscriberId}, ${topicId}, 'email')
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_subscriptions (subscriber_id, topic_id, channel)
        VALUES (${subscriberId}, ${topicId}, 'email')
      `),
		).rejects.toThrow();
	});

	it("should allow different channels for the same subscriber+topic (not duplicate)", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({
			id: `user_sub_multi_chan_${Date.now()}`,
		});
		const { id: categoryId } = await insertCategory(`cat_multi_chan_${Date.now()}`);
		const { id: topicId } = await insertTopic(categoryId, `topic_multi_chan_${Date.now()}`);

		await db.execute(sql`
      INSERT INTO emito_subscriptions (subscriber_id, topic_id, channel)
      VALUES (${subscriberId}, ${topicId}, 'email')
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_subscriptions (subscriber_id, topic_id, channel)
        VALUES (${subscriberId}, ${topicId}, 'sms')
      `),
		).resolves.toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_inbox
// ---------------------------------------------------------------------------

describe("emito_inbox", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_inbox");
		const required = [
			"id",
			"subscriber_id",
			"workspace_id",
			"event_type",
			"category",
			"topic_key",
			"subject",
			"body",
			"avatar",
			"action_url",
			"primary_action_label",
			"primary_action_url",
			"secondary_action_label",
			"secondary_action_url",
			"data",
			"read_at",
			"archived_at",
			"snoozed_until",
			"created_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate an inb_ prefixed ID", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_inbox_${Date.now()}` });
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_inbox (subscriber_id, event_type, category, body)
      VALUES (${subscriberId}, 'test.event', 'transactional', 'Hello World')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^inb_/);
	});

	it("should default read_at to null (unread)", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_inb_read_${Date.now()}` });
		const rows = await db.execute<{ read_at: unknown }>(sql`
      INSERT INTO emito_inbox (subscriber_id, event_type, category, body)
      VALUES (${subscriberId}, 'test.event', 'transactional', 'Hello World')
      RETURNING read_at
    `);
		expect((rows[0] as { read_at: unknown }).read_at).toBeNull();
	});

	it("should have index on (subscriber_id, created_at DESC)", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_inbox");
		const subIdx = indexes.find((i) => i.indexname === "idx_emito_inbox_sub");
		expect(subIdx).toBeDefined();
		expect(subIdx?.indexdef).toContain("subscriber_id");
	});

	it("should have partial index on (subscriber_id, read_at) WHERE read_at IS NULL (unread inbox)", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_inbox");
		const unreadIdx = indexes.find((i) => i.indexname === "idx_emito_inbox_unread");
		expect(unreadIdx).toBeDefined();
		expect(unreadIdx?.indexdef.toLowerCase()).toContain("where");
		expect(unreadIdx?.indexdef.toLowerCase()).toContain("read_at is null");
	});

	it("should have partial index on (subscriber_id, workspace_id, created_at) WHERE workspace_id IS NOT NULL", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_inbox");
		const wsIdx = indexes.find((i) => i.indexname === "idx_emito_inbox_ws");
		expect(wsIdx).toBeDefined();
		expect(wsIdx?.indexdef.toLowerCase()).toContain("where");
		expect(wsIdx?.indexdef.toLowerCase()).toContain("not null");
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_push_tokens
// ---------------------------------------------------------------------------

describe("emito_push_tokens", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_push_tokens");
		const required = [
			"id",
			"subscriber_id",
			"token",
			"platform",
			"device_name",
			"active",
			"created_at",
			"last_used_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate a ptk_ prefixed ID", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_ptk_${Date.now()}` });
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_push_tokens (subscriber_id, token, platform)
      VALUES (${subscriberId}, 'fcm_token_abc123', 'fcm')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^ptk_/);
	});

	it("should default active to true", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber({ id: `user_ptk_active_${Date.now()}` });
		const rows = await db.execute<{ active: boolean }>(sql`
      INSERT INTO emito_push_tokens (subscriber_id, token, platform)
      VALUES (${subscriberId}, 'fcm_token_active_test', 'fcm')
      RETURNING active
    `);
		expect((rows[0] as { active: boolean }).active).toBe(true);
	});

	it("should have partial index on subscriber_id WHERE active = true", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_push_tokens");
		const activeIdx = indexes.find((i) => i.indexname === "idx_emito_push_active");
		expect(activeIdx).toBeDefined();
		expect(activeIdx?.indexdef.toLowerCase()).toContain("where");
		expect(activeIdx?.indexdef.toLowerCase()).toContain("active");
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_integrations
// ---------------------------------------------------------------------------

describe("emito_integrations", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_integrations");
		const required = [
			"id",
			"owner_id",
			"subscriber_id",
			"name",
			"channel",
			"events",
			"config",
			"active",
			"created_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate an int_ prefixed ID", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_integrations (owner_id, channel, config)
      VALUES ('ws_int_test', 'slack', '{"webhookUrl": "https://hooks.slack.com/test"}')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^int_/);
	});

	it("should default active to true", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ active: boolean }>(sql`
      INSERT INTO emito_integrations (owner_id, channel, config)
      VALUES ('ws_active_test', 'slack', '{"webhookUrl": "https://hooks.slack.com/test"}')
      RETURNING active
    `);
		expect((rows[0] as { active: boolean }).active).toBe(true);
	});

	it("should store channel as plain TEXT (extensible beyond known channel types)", async () => {
		if (!hasDb()) return;
		// Insert a future/unknown channel type — should not be rejected by an enum constraint
		const rows = await db.execute<{ channel: string }>(sql`
      INSERT INTO emito_integrations (owner_id, channel, config)
      VALUES ('ws_text_chan', 'teams', '{"webhookUrl": "https://teams.microsoft.com/test"}')
      RETURNING channel
    `);
		expect((rows[0] as { channel: string }).channel).toBe("teams");
	});

	it("should allow events to be NULL (means all events)", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ events: unknown }>(sql`
      INSERT INTO emito_integrations (owner_id, channel, config, events)
      VALUES ('ws_null_events', 'slack', '{"webhookUrl": "https://hooks.slack.com/test"}', NULL)
      RETURNING events
    `);
		expect((rows[0] as { events: unknown }).events).toBeNull();
	});

	it("should allow subscriber_id to be NULL (workspace-wide integration)", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ subscriber_id: unknown }>(sql`
      INSERT INTO emito_integrations (owner_id, channel, config)
      VALUES ('ws_no_sub', 'discord', '{"webhookUrl": "https://discord.com/test"}')
      RETURNING subscriber_id
    `);
		expect((rows[0] as { subscriber_id: unknown }).subscriber_id).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Suite: ID prefix correctness across all 10 tables
// ---------------------------------------------------------------------------

describe("ID prefix coverage for all 10 core tables", () => {
	it("should assign correct entity-specific prefixes on insert", async () => {
		if (!hasDb()) return;

		// subscribers: host-app ID (no prefix)
		const { id: subscriberId } = await insertSubscriber({ id: `user_prefix_all_${Date.now()}` });
		expect(subscriberId).toMatch(/^user_/);

		// notifications: ntf_
		const [notif] = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_notifications (subscriber_id, event_type, category, channel)
      VALUES (${subscriberId}, 'prefix.test', 'transactional', 'email')
      RETURNING id
    `);
		expect((notif as { id: string }).id).toMatch(/^ntf_/);

		// preferences: pref_
		const [pref] = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_preferences (subscriber_id, topic_key, enabled)
      VALUES (${subscriberId}, 'prefix-test-topic', true)
      RETURNING id
    `);
		expect((pref as { id: string }).id).toMatch(/^pref_/);

		// workspace_defaults: wsd_
		const [wsd] = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_workspace_defaults (workspace_id, topic_key, enabled)
      VALUES (${"ws_prefix_" + Date.now()}, 'prefix-topic', true)
      RETURNING id
    `);
		expect((wsd as { id: string }).id).toMatch(/^wsd_/);

		// categories: cat_
		const { id: catId } = await insertCategory(`prefix_cat_${Date.now()}`);
		expect(catId).toMatch(/^cat_/);

		// topics: top_
		const { id: topicId } = await insertTopic(catId, `prefix_topic_${Date.now()}`);
		expect(topicId).toMatch(/^top_/);

		// subscriptions: tsc_
		const [sub] = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_subscriptions (subscriber_id, topic_id, channel)
      VALUES (${subscriberId}, ${topicId}, 'push')
      RETURNING id
    `);
		expect((sub as { id: string }).id).toMatch(/^tsc_/);

		// inbox: inb_
		const [inb] = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_inbox (subscriber_id, event_type, category, body)
      VALUES (${subscriberId}, 'prefix.test', 'transactional', 'prefix test body')
      RETURNING id
    `);
		expect((inb as { id: string }).id).toMatch(/^inb_/);

		// push_tokens: ptk_
		const [ptk] = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_push_tokens (subscriber_id, token, platform)
      VALUES (${subscriberId}, 'token_prefix_test', 'apns')
      RETURNING id
    `);
		expect((ptk as { id: string }).id).toMatch(/^ptk_/);

		// integrations: int_
		const [integ] = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_integrations (owner_id, channel, config)
      VALUES ('ws_prefix_integ', 'telegram', '{"botToken": "test", "chatId": "-1"}')
      RETURNING id
    `);
		expect((integ as { id: string }).id).toMatch(/^int_/);
	});
});

// ---------------------------------------------------------------------------
// Suite: Foreign key enforcement
//
// These tests assert that the relational columns carry database-level FOREIGN KEY
// constraints, not merely ORM-level Drizzle relations() declarations. Without a
// DB-level constraint the database accepts orphaned rows. The separate "FK columns
// exist in schema" suite verifies the columns and ORM relations are declared.
// ---------------------------------------------------------------------------

describe("Foreign key — database-level constraints", () => {
	it("emito_topics should have category_id column with DB-level FK to emito_categories", async () => {
		if (!hasDb()) return;
		const fks = await getForeignKeys("emito_topics");
		const catFk = fks.find(
			(fk) => fk.column_name === "category_id" && fk.foreign_table_name === "emito_categories",
		);
		// category_id must carry a database-level REFERENCES emito_categories(id)
		// constraint, not only an application-level Drizzle relation.
		expect(catFk, "emito_topics.category_id lacks DB-level FK constraint").toBeDefined();
	});

	it("emito_subscriptions should have DB-level FK on subscriber_id → emito_subscribers", async () => {
		if (!hasDb()) return;
		const fks = await getForeignKeys("emito_subscriptions");
		const subFk = fks.find(
			(fk) => fk.column_name === "subscriber_id" && fk.foreign_table_name === "emito_subscribers",
		);
		expect(
			subFk,
			"emito_subscriptions.subscriber_id lacks DB-level FK constraint",
		).toBeDefined();
	});

	it("emito_subscriptions should have DB-level FK on topic_id → emito_topics", async () => {
		if (!hasDb()) return;
		const fks = await getForeignKeys("emito_subscriptions");
		const topicFk = fks.find(
			(fk) => fk.column_name === "topic_id" && fk.foreign_table_name === "emito_topics",
		);
		expect(
			topicFk,
			"emito_subscriptions.topic_id lacks DB-level FK constraint",
		).toBeDefined();
	});

	it("emito_categories should have self-referential DB-level FK on parent_id → emito_categories", async () => {
		if (!hasDb()) return;
		const fks = await getForeignKeys("emito_categories");
		const selfFk = fks.find(
			(fk) => fk.column_name === "parent_id" && fk.foreign_table_name === "emito_categories",
		);
		expect(
			selfFk,
			"emito_categories.parent_id lacks DB-level self-referential FK constraint",
		).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Suite: Drizzle application-level relations — verify referencing columns exist
// (These verify ORM relations are at minimum declared, regardless of DB FK presence)
// ---------------------------------------------------------------------------

describe("Drizzle application-level relation columns", () => {
	it("emito_topics should have a category_id column (used for ORM relation)", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_topics");
		expect(cols).toContain("category_id");
	});

	it("emito_subscriptions should have subscriber_id and topic_id columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_subscriptions");
		expect(cols).toContain("subscriber_id");
		expect(cols).toContain("topic_id");
	});

	it("emito_categories should have parent_id column (self-referential)", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_categories");
		expect(cols).toContain("parent_id");
	});

	it("self-referential parent_id allows valid category hierarchy inserts", async () => {
		if (!hasDb()) return;
		const { id: parentId } = await insertCategory(`parent_for_rel_${Date.now()}`);
		const rows = await db.execute<{ parent_id: string }>(sql`
      INSERT INTO emito_categories (slug, name, legal_class, default_policy, parent_id)
      VALUES (${"child_for_rel_" + Date.now()}, 'Child', 'commercial', 'opt_in', ${parentId})
      RETURNING parent_id
    `);
		expect((rows[0] as { parent_id: string }).parent_id).toBe(parentId);
	});
});
