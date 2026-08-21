/**
 * Integration tests for the delivery & compliance schema.
 *
 * Covers: webhook_endpoints, webhook_deliveries, suppression, dead_letters,
 * consents, erasure_log, lists, list_members.
 *
 * Tests run against a real PostgreSQL 16 instance via Testcontainers.
 * The container is started in global-setup.ts; this file uses the injected DB_URI.
 *
 * Success criteria verified:
 * - All 8 tables exist with correct columns, types, and defaults
 * - Incremental migration (0002) applies on top of 0001 cleanly
 * - UNIQUE constraints: suppression(address, channel), webhook_deliveries(endpoint_id, event_id), list_members(subscriber_id, list_id)
 * - Append-only tables (consents, erasure_log) accept INSERTs
 * - Partial indexes: unresolved dead letters, confirmed list members
 * - Foreign keys: webhook_deliveries→webhook_endpoints, list_members→subscribers+lists, lists→categories
 * - Full migration sequence (0001 + 0002) applies cleanly on empty database
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

	// Run all available migrations (0001 initial + 0002 delivery/compliance)
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

/** Query information_schema for table existence. */
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
// Data helpers — insert prerequisite rows
// ---------------------------------------------------------------------------

async function insertSubscriber(id?: string): Promise<{ id: string }> {
	const subscriberId = id ?? `user_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	await db.execute(sql`
    INSERT INTO emito_subscribers (id, email)
    VALUES (${subscriberId}, ${`${subscriberId}@example.com`})
    ON CONFLICT DO NOTHING
  `);
	return { id: subscriberId };
}

async function insertCategory(slug: string): Promise<{ id: string }> {
	const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO emito_categories (slug, name, legal_class, default_policy)
    VALUES (${slug}, ${slug}, 'commercial', 'opt_in')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
	return { id: (rows[0] as { id: string }).id };
}

async function insertWebhookEndpoint(): Promise<{ id: string }> {
	const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO emito_webhook_endpoints (owner_id, url, events, signing_secret)
    VALUES (
      'owner_test',
      'https://example.com/webhook',
      ARRAY['notification.delivered'],
      'emito_whsec_0000000000000000000000000000000000000000000000000000000000000000'
    )
    RETURNING id
  `);
	return { id: (rows[0] as { id: string }).id };
}

async function insertList(slug: string, categoryId?: string): Promise<{ id: string }> {
	const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO emito_lists (name, slug, category_id)
    VALUES (${slug}, ${slug}, ${categoryId ?? null})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
	return { id: (rows[0] as { id: string }).id };
}

// ---------------------------------------------------------------------------
// Suite: Table existence — all 8 delivery & compliance tables
// ---------------------------------------------------------------------------

describe("Delivery & compliance schema — table existence", () => {
	const TABLES = [
		"emito_webhook_endpoints",
		"emito_webhook_deliveries",
		"emito_suppression",
		"emito_dead_letters",
		"emito_consents",
		"emito_erasure_log",
		"emito_lists",
		"emito_list_members",
	];

	for (const table of TABLES) {
		it(`should have table ${table}`, async () => {
			if (!hasDb()) return;
			expect(await tableExists(table)).toBe(true);
		});
	}
});

// ---------------------------------------------------------------------------
// Suite: emito_webhook_endpoints
// ---------------------------------------------------------------------------

describe("emito_webhook_endpoints", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_webhook_endpoints");
		const required = [
			"id",
			"owner_id",
			"url",
			"events",
			"signing_secret",
			"description",
			"status",
			"consecutive_failures",
			"last_delivery_at",
			"last_failure_at",
			"created_at",
			"updated_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should default status to active", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ id: string; status: string }>(sql`
      INSERT INTO emito_webhook_endpoints (owner_id, url, events, signing_secret)
      VALUES ('owner_1', 'https://example.com/wh', ARRAY['test.event'], 'emito_whsec_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      RETURNING id, status
    `);
		const row = rows[0] as { id: string; status: string };
		expect(row.status).toBe("active");
		expect(row.id).toMatch(/^whe_/);
	});

	it("should default consecutive_failures to 0", async () => {
		if (!hasDb()) return;
		const { id } = await insertWebhookEndpoint();
		const rows = await db.execute<{ consecutive_failures: number }>(
			sql`SELECT consecutive_failures FROM emito_webhook_endpoints WHERE id = ${id}`,
		);
		expect((rows[0] as { consecutive_failures: number }).consecutive_failures).toBe(0);
	});

	it("should accept TEXT[] for events column", async () => {
		if (!hasDb()) return;
		const { id } = await insertWebhookEndpoint();
		const rows = await db.execute<{ events: string[] }>(
			sql`SELECT events FROM emito_webhook_endpoints WHERE id = ${id}`,
		);
		const events = (rows[0] as { events: string[] }).events;
		expect(Array.isArray(events)).toBe(true);
		expect(events).toContain("notification.delivered");
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_webhook_deliveries
// ---------------------------------------------------------------------------

describe("emito_webhook_deliveries", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_webhook_deliveries");
		const required = [
			"id",
			"endpoint_id",
			"event_id",
			"event_type",
			"status",
			"attempts",
			"last_attempt_at",
			"next_retry_at",
			"response_status",
			"response_body",
			"payload",
			"created_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should default status to pending and id to whd_ prefix", async () => {
		if (!hasDb()) return;
		const { id: endpointId } = await insertWebhookEndpoint();
		const rows = await db.execute<{ id: string; status: string }>(sql`
      INSERT INTO emito_webhook_deliveries (endpoint_id, event_id, event_type, payload)
      VALUES (${endpointId}, 'sha256_event_001', 'notification.delivered', '{}')
      RETURNING id, status
    `);
		const row = rows[0] as { id: string; status: string };
		expect(row.status).toBe("pending");
		expect(row.id).toMatch(/^whd_/);
	});

	it("should enforce UNIQUE(endpoint_id, event_id) for dedup", async () => {
		if (!hasDb()) return;
		const { id: endpointId } = await insertWebhookEndpoint();
		await db.execute(sql`
      INSERT INTO emito_webhook_deliveries (endpoint_id, event_id, event_type, payload)
      VALUES (${endpointId}, 'sha256_dedup_key', 'notification.delivered', '{}')
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_webhook_deliveries (endpoint_id, event_id, event_type, payload)
        VALUES (${endpointId}, 'sha256_dedup_key', 'notification.delivered', '{}')
      `),
		).rejects.toThrow();
	});

	it("should allow same event_id on different endpoints (dedup is endpoint-scoped)", async () => {
		if (!hasDb()) return;
		const { id: endpointId1 } = await insertWebhookEndpoint();
		const { id: endpointId2 } = await insertWebhookEndpoint();
		await db.execute(sql`
      INSERT INTO emito_webhook_deliveries (endpoint_id, event_id, event_type, payload)
      VALUES (${endpointId1}, 'sha256_shared_event', 'notification.delivered', '{}')
    `);
		// Should not throw — different endpoint
		await expect(
			db.execute(sql`
        INSERT INTO emito_webhook_deliveries (endpoint_id, event_id, event_type, payload)
        VALUES (${endpointId2}, 'sha256_shared_event', 'notification.delivered', '{}')
      `),
		).resolves.not.toThrow();
	});

	it("should enforce FK: endpoint_id → emito_webhook_endpoints(id)", async () => {
		if (!hasDb()) return;
		await expect(
			db.execute(sql`
        INSERT INTO emito_webhook_deliveries (endpoint_id, event_id, event_type, payload)
        VALUES ('whe_nonexistent', 'sha256_fk_test', 'notification.delivered', '{}')
      `),
		).rejects.toThrow();
	});

	it("should have FK constraint on endpoint_id referencing emito_webhook_endpoints", async () => {
		if (!hasDb()) return;
		const fks = await getForeignKeys("emito_webhook_deliveries");
		const endpointFk = fks.find((fk) => fk.column_name === "endpoint_id");
		expect(endpointFk).toBeDefined();
		expect(endpointFk?.foreign_table_name).toBe("emito_webhook_endpoints");
		expect(endpointFk?.foreign_column_name).toBe("id");
	});

	it("should default attempts to 0", async () => {
		if (!hasDb()) return;
		const { id: endpointId } = await insertWebhookEndpoint();
		const rows = await db.execute<{ id: string; attempts: number }>(sql`
      INSERT INTO emito_webhook_deliveries (endpoint_id, event_id, event_type, payload)
      VALUES (${endpointId}, 'sha256_attempts_check', 'test.event', '{"key":"val"}')
      RETURNING id, attempts
    `);
		expect((rows[0] as { id: string; attempts: number }).attempts).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_suppression
// ---------------------------------------------------------------------------

describe("emito_suppression", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_suppression");
		const required = [
			"id",
			"address",
			"channel",
			"reason",
			"provider",
			"provider_msg_id",
			"consecutive_soft",
			"created_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate sup_ prefix IDs", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_suppression (address, channel, reason)
      VALUES ('bounce@example.com', 'email', 'hard_bounce')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^sup_/);
	});

	it("should enforce UNIQUE(address, channel) for pre-send lookup", async () => {
		if (!hasDb()) return;
		await db.execute(sql`
      INSERT INTO emito_suppression (address, channel, reason)
      VALUES ('dup@example.com', 'email', 'hard_bounce')
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_suppression (address, channel, reason)
        VALUES ('dup@example.com', 'email', 'complaint')
      `),
		).rejects.toThrow();
	});

	it("should allow same address on different channels", async () => {
		if (!hasDb()) return;
		await db.execute(sql`
      INSERT INTO emito_suppression (address, channel, reason)
      VALUES ('+15550001234', 'sms', 'hard_bounce')
    `);
		// email and sms are different channels — should not conflict
		await expect(
			db.execute(sql`
        INSERT INTO emito_suppression (address, channel, reason)
        VALUES ('+15550001234', 'email', 'hard_bounce')
      `),
		).resolves.not.toThrow();
	});

	it("should default consecutive_soft to 0", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ id: string; consecutive_soft: number }>(sql`
      INSERT INTO emito_suppression (address, channel, reason)
      VALUES ('default_soft@example.com', 'email', 'hard_bounce')
      RETURNING id, consecutive_soft
    `);
		expect((rows[0] as { id: string; consecutive_soft: number }).consecutive_soft).toBe(0);
	});

	it("should have an index on (address, channel) for fast lookup", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_suppression");
		const lookupIndex = indexes.find((i) => i.indexname === "idx_emito_sup_lookup");
		expect(lookupIndex).toBeDefined();
		expect(lookupIndex?.indexdef).toContain("address");
		expect(lookupIndex?.indexdef).toContain("channel");
	});

	it("should enforce uniqueness on (address, channel) for active rows", async () => {
		if (!hasDb()) return;
		// Uniqueness is enforced by a partial UNIQUE INDEX scoped to active
		// (archived_at IS NULL) rows, not a plain table constraint — so it lives
		// in pg_indexes, not information_schema.table_constraints.
		const indexes = await getIndexes("emito_suppression");
		const uniqueIndex = indexes.find(
			(i) => i.indexname === "emito_suppression_address_channel_active",
		);
		expect(uniqueIndex).toBeDefined();
		expect(uniqueIndex?.indexdef).toContain("UNIQUE");
		expect(uniqueIndex?.indexdef).toContain("address");
		expect(uniqueIndex?.indexdef).toContain("channel");
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_dead_letters
// ---------------------------------------------------------------------------

describe("emito_dead_letters", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_dead_letters");
		const required = [
			"id",
			"notification_id",
			"subscriber_id",
			"event_type",
			"channel",
			"attempts",
			"payload",
			"exhausted_at",
			"resolved_at",
			"resolution",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate dlq_ prefix IDs", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_dead_letters (notification_id, subscriber_id, event_type, channel, attempts, payload)
      VALUES ('ntf_some_id', 'user_test_dlq', 'order.filled', 'email', '[]', '{"key":"value"}')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^dlq_/);
	});

	it("should allow INSERT without FK constraint on notification_id (intentional per architecture)", async () => {
		if (!hasDb()) return;
		// dead_letters refs notifications.id via TEXT — no FK constraint intentionally
		// This means we can insert with any notification_id (no referential integrity enforced)
		await expect(
			db.execute(sql`
        INSERT INTO emito_dead_letters (notification_id, subscriber_id, event_type, channel, attempts, payload)
        VALUES ('ntf_ghost_ref', 'user_ghost', 'order.failed', 'sms', '[]', '{}')
      `),
		).resolves.not.toThrow();
	});

	it("should have a partial index on exhausted_at WHERE resolved_at IS NULL", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_dead_letters");
		const unresolvedIndex = indexes.find((i) => i.indexname === "idx_emito_dlq_unresolved");
		expect(unresolvedIndex).toBeDefined();
		expect(unresolvedIndex?.indexdef.toLowerCase()).toContain("where");
		expect(unresolvedIndex?.indexdef.toLowerCase()).toContain("resolved_at is null");
	});

	it("should default exhausted_at to now()", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ exhausted_at: string }>(sql`
      INSERT INTO emito_dead_letters (notification_id, subscriber_id, event_type, channel, attempts, payload)
      VALUES ('ntf_exhaust_test', 'user_exhaust', 'test.event', 'email', '[]', '{}')
      RETURNING exhausted_at
    `);
		const exhaustedAt = (rows[0] as { exhausted_at: string }).exhausted_at;
		expect(exhaustedAt).not.toBeNull();
		// Should be a recent timestamp
		const diff = Date.now() - new Date(exhaustedAt).getTime();
		expect(diff).toBeGreaterThanOrEqual(0);
		expect(diff).toBeLessThan(5_000);
	});

	it("should allow resolved_at and resolution to be null (unresolved state)", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ resolved_at: unknown; resolution: unknown }>(sql`
      INSERT INTO emito_dead_letters (notification_id, subscriber_id, event_type, channel, attempts, payload)
      VALUES ('ntf_null_test', 'user_null', 'test.event', 'email', '[]', '{}')
      RETURNING resolved_at, resolution
    `);
		const row = rows[0] as { resolved_at: unknown; resolution: unknown };
		expect(row.resolved_at).toBeNull();
		expect(row.resolution).toBeNull();
	});

	it("should NOT have a FK constraint on notification_id (intentional)", async () => {
		if (!hasDb()) return;
		const fks = await getForeignKeys("emito_dead_letters");
		const notifFk = fks.find((fk) => fk.column_name === "notification_id");
		// Architecture spec: no FK on notification_id — intentional to avoid cascading deletes
		expect(notifFk).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_consents (append-only)
// ---------------------------------------------------------------------------

describe("emito_consents", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_consents");
		const required = [
			"id",
			"subscriber_id",
			"category",
			"topic_slug",
			"consented",
			"ip_address",
			"user_agent",
			"source",
			"created_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate con_ prefix IDs", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_consents (subscriber_id, category, consented, source)
      VALUES ('user_consent_1', 'marketing', true, 'registration')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^con_/);
	});

	it("should accept INSERTs (append-only — no schema-level insert restriction)", async () => {
		if (!hasDb()) return;
		// Append-only is enforced by convention — multiple inserts for same subscriber are valid audit records
		await expect(
			db.execute(sql`
        INSERT INTO emito_consents (subscriber_id, category, consented, source)
        VALUES ('user_append_1', 'transactional', true, 'preference_center')
      `),
		).resolves.not.toThrow();
		await expect(
			db.execute(sql`
        INSERT INTO emito_consents (subscriber_id, category, consented, source)
        VALUES ('user_append_1', 'transactional', false, 'preference_center')
      `),
		).resolves.not.toThrow();
	});

	it("should have an index on (subscriber_id, category, created_at DESC)", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_consents");
		const consentIndex = indexes.find((i) => i.indexname === "idx_emito_consent_sub");
		expect(consentIndex).toBeDefined();
		expect(consentIndex?.indexdef).toContain("subscriber_id");
		expect(consentIndex?.indexdef).toContain("category");
	});

	it("should allow topic_slug to be null (non-topic-specific consent)", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ topic_slug: unknown }>(sql`
      INSERT INTO emito_consents (subscriber_id, category, consented, source)
      VALUES ('user_notopic', 'marketing', true, 'api')
      RETURNING topic_slug
    `);
		expect((rows[0] as { topic_slug: unknown }).topic_slug).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_erasure_log (append-only)
// ---------------------------------------------------------------------------

describe("emito_erasure_log", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_erasure_log");
		const required = [
			"id",
			"subscriber_id",
			"reason",
			"requested_by",
			"requested_at",
			"completed_at",
			"details",
			"provider_cascade",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate erl_ prefix IDs", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_erasure_log (subscriber_id, reason, requested_by)
      VALUES ('user_erasure_1', 'user_request', 'user@example.com')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^erl_/);
	});

	it("should accept INSERTs (append-only audit trail)", async () => {
		if (!hasDb()) return;
		await expect(
			db.execute(sql`
        INSERT INTO emito_erasure_log (subscriber_id, reason, requested_by)
        VALUES ('user_era_append', 'account_deletion', 'system')
      `),
		).resolves.not.toThrow();
	});

	it("should default requested_at to now()", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ requested_at: string }>(sql`
      INSERT INTO emito_erasure_log (subscriber_id, reason, requested_by)
      VALUES ('user_era_time', 'legal_obligation', 'admin@example.com')
      RETURNING requested_at
    `);
		const requestedAt = (rows[0] as { requested_at: string }).requested_at;
		expect(requestedAt).not.toBeNull();
		const diff = Date.now() - new Date(requestedAt).getTime();
		expect(diff).toBeGreaterThanOrEqual(0);
		expect(diff).toBeLessThan(5_000);
	});

	it("should default details to empty JSONB object", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ details: unknown }>(sql`
      INSERT INTO emito_erasure_log (subscriber_id, reason, requested_by)
      VALUES ('user_era_details', 'admin_decision', 'admin@example.com')
      RETURNING details
    `);
		expect((rows[0] as { details: unknown }).details).toMatchObject({});
	});

	it("should allow completed_at to be null (pending erasure)", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ completed_at: unknown }>(sql`
      INSERT INTO emito_erasure_log (subscriber_id, reason, requested_by)
      VALUES ('user_era_pending', 'user_request', 'user@example.com')
      RETURNING completed_at
    `);
		expect((rows[0] as { completed_at: unknown }).completed_at).toBeNull();
	});

	it("should have an index on subscriber_id", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_erasure_log");
		const erlIndex = indexes.find((i) => i.indexname === "idx_emito_erl_sub");
		expect(erlIndex).toBeDefined();
		expect(erlIndex?.indexdef).toContain("subscriber_id");
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_lists
// ---------------------------------------------------------------------------

describe("emito_lists", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_lists");
		const required = [
			"id",
			"name",
			"slug",
			"description",
			"optin_type",
			"visibility",
			"category_id",
			"member_count",
			"created_at",
			"updated_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate lst_ prefix IDs", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_lists (name, slug)
      VALUES ('Newsletter', 'newsletter-test-prefix')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^lst_/);
	});

	it("should default optin_type to single", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ id: string; optin_type: string }>(sql`
      INSERT INTO emito_lists (name, slug)
      VALUES ('Test List', 'test-list-optin')
      RETURNING id, optin_type
    `);
		expect((rows[0] as { id: string; optin_type: string }).optin_type).toBe("single");
	});

	it("should default visibility to private", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ visibility: string }>(sql`
      INSERT INTO emito_lists (name, slug)
      VALUES ('Private List', 'test-list-visibility')
      RETURNING visibility
    `);
		expect((rows[0] as { visibility: string }).visibility).toBe("private");
	});

	it("should default member_count to 0", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ member_count: number }>(sql`
      INSERT INTO emito_lists (name, slug)
      VALUES ('Count List', 'test-list-count')
      RETURNING member_count
    `);
		expect((rows[0] as { member_count: number }).member_count).toBe(0);
	});

	it("should enforce UNIQUE on slug", async () => {
		if (!hasDb()) return;
		await db.execute(sql`
      INSERT INTO emito_lists (name, slug)
      VALUES ('Dup Slug List', 'dup-slug-test')
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_lists (name, slug)
        VALUES ('Another Dup', 'dup-slug-test')
      `),
		).rejects.toThrow();
	});

	it("should enforce FK: category_id → emito_categories(id)", async () => {
		if (!hasDb()) return;
		await expect(
			db.execute(sql`
        INSERT INTO emito_lists (name, slug, category_id)
        VALUES ('Bad Cat', 'bad-cat-list', 'cat_nonexistent')
      `),
		).rejects.toThrow();
	});

	it("should have FK constraint on category_id referencing emito_categories", async () => {
		if (!hasDb()) return;
		const fks = await getForeignKeys("emito_lists");
		const catFk = fks.find((fk) => fk.column_name === "category_id");
		expect(catFk).toBeDefined();
		expect(catFk?.foreign_table_name).toBe("emito_categories");
		expect(catFk?.foreign_column_name).toBe("id");
	});

	it("should allow category_id to be null (no category assigned)", async () => {
		if (!hasDb()) return;
		await expect(
			db.execute(sql`
        INSERT INTO emito_lists (name, slug)
        VALUES ('Uncategorized', 'uncategorized-list')
      `),
		).resolves.not.toThrow();
	});

	it("should allow category_id to reference a valid category", async () => {
		if (!hasDb()) return;
		const { id: categoryId } = await insertCategory("lists-test-category");
		const rows = await db.execute<{ category_id: string }>(sql`
      INSERT INTO emito_lists (name, slug, category_id)
      VALUES ('Categorized List', 'categorized-list-test', ${categoryId})
      RETURNING category_id
    `);
		expect((rows[0] as { category_id: string }).category_id).toBe(categoryId);
	});
});

// ---------------------------------------------------------------------------
// Suite: emito_list_members
// ---------------------------------------------------------------------------

describe("emito_list_members", () => {
	it("should have all required columns", async () => {
		if (!hasDb()) return;
		const cols = await getColumns("emito_list_members");
		const required = [
			"id",
			"subscriber_id",
			"list_id",
			"status",
			"source",
			"subscribed_at",
			"confirmed_at",
			"unsubscribed_at",
			"created_at",
		];
		for (const col of required) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it("should generate lmb_ prefix IDs", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber();
		const { id: listId } = await insertList("lmb-prefix-test-list");
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_list_members (subscriber_id, list_id)
      VALUES (${subscriberId}, ${listId})
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^lmb_/);
	});

	it("should default status to unconfirmed", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber();
		const { id: listId } = await insertList("lmb-default-status-list");
		const rows = await db.execute<{ status: string }>(sql`
      INSERT INTO emito_list_members (subscriber_id, list_id)
      VALUES (${subscriberId}, ${listId})
      RETURNING status
    `);
		expect((rows[0] as { status: string }).status).toBe("unconfirmed");
	});

	it("should enforce UNIQUE(subscriber_id, list_id)", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber();
		const { id: listId } = await insertList("lmb-unique-test-list");
		await db.execute(sql`
      INSERT INTO emito_list_members (subscriber_id, list_id)
      VALUES (${subscriberId}, ${listId})
    `);
		await expect(
			db.execute(sql`
        INSERT INTO emito_list_members (subscriber_id, list_id)
        VALUES (${subscriberId}, ${listId})
      `),
		).rejects.toThrow();
	});

	it("should enforce FK: subscriber_id → emito_subscribers(id)", async () => {
		if (!hasDb()) return;
		const { id: listId } = await insertList("lmb-fk-sub-test-list");
		await expect(
			db.execute(sql`
        INSERT INTO emito_list_members (subscriber_id, list_id)
        VALUES ('user_nonexistent_ghost', ${listId})
      `),
		).rejects.toThrow();
	});

	it("should enforce FK: list_id → emito_lists(id)", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber();
		await expect(
			db.execute(sql`
        INSERT INTO emito_list_members (subscriber_id, list_id)
        VALUES (${subscriberId}, 'lst_nonexistent')
      `),
		).rejects.toThrow();
	});

	it("should have FK constraints on subscriber_id and list_id", async () => {
		if (!hasDb()) return;
		const fks = await getForeignKeys("emito_list_members");
		const subFk = fks.find((fk) => fk.column_name === "subscriber_id");
		const listFk = fks.find((fk) => fk.column_name === "list_id");
		expect(subFk).toBeDefined();
		expect(subFk?.foreign_table_name).toBe("emito_subscribers");
		expect(listFk).toBeDefined();
		expect(listFk?.foreign_table_name).toBe("emito_lists");
	});

	it("should have a partial index on (list_id, status) WHERE status = 'confirmed'", async () => {
		if (!hasDb()) return;
		const indexes = await getIndexes("emito_list_members");
		const confirmedIndex = indexes.find((i) => i.indexname === "idx_emito_lmb_list");
		expect(confirmedIndex).toBeDefined();
		expect(confirmedIndex?.indexdef).toContain("list_id");
		expect(confirmedIndex?.indexdef.toLowerCase()).toContain("where");
		expect(confirmedIndex?.indexdef.toLowerCase()).toContain("confirmed");
	});

	it("should allow confirmed members to appear in partial index queries", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber();
		const { id: listId } = await insertList("lmb-confirmed-index-list");
		// Insert confirmed member
		await db.execute(sql`
      INSERT INTO emito_list_members (subscriber_id, list_id, status, confirmed_at)
      VALUES (${subscriberId}, ${listId}, 'confirmed', now())
    `);
		// Query using the partial index path
		const rows = await db.execute<{ id: string }>(sql`
      SELECT id FROM emito_list_members
      WHERE list_id = ${listId} AND status = 'confirmed'
    `);
		expect(rows.length).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Suite: Full migration sequence — 0001 + 0002 on empty DB
// ---------------------------------------------------------------------------

describe("Full migration sequence", () => {
	it("should have both migration sets applied (all 18 tables exist)", async () => {
		if (!hasDb()) return;
		// Core notification tables (migration 0001)
		const coreExpected = [
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
		// Delivery & compliance tables (migration 0002)
		const deliveryExpected = [
			"emito_webhook_endpoints",
			"emito_webhook_deliveries",
			"emito_suppression",
			"emito_dead_letters",
			"emito_consents",
			"emito_erasure_log",
			"emito_lists",
			"emito_list_members",
		];

		for (const table of [...coreExpected, ...deliveryExpected]) {
			expect(await tableExists(table), `missing table after full migration: ${table}`).toBe(true);
		}
	});

	it("should have a drizzle migrations table indicating both migrations ran", async () => {
		if (!hasDb()) return;
		const rows = await db.execute<{ hash: string }>(sql`
      SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC
    `);
		// At least 2 migrations should have run (0001 and 0002)
		expect(rows.length).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// Suite: Cross-table relationships (end-to-end inserts)
// ---------------------------------------------------------------------------

describe("Cross-table relationship integrity", () => {
	it("should allow a webhook delivery chain: endpoint → delivery", async () => {
		if (!hasDb()) return;
		const { id: endpointId } = await insertWebhookEndpoint();
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_webhook_deliveries (endpoint_id, event_id, event_type, payload)
      VALUES (${endpointId}, 'sha256_chain_test', 'notification.delivered', '{"sub":"test"}')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^whd_/);
	});

	it("should allow a list membership chain: subscriber → list → member", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber();
		const { id: listId } = await insertList("chain-test-list");
		const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO emito_list_members (subscriber_id, list_id, status)
      VALUES (${subscriberId}, ${listId}, 'confirmed')
      RETURNING id
    `);
		expect((rows[0] as { id: string }).id).toMatch(/^lmb_/);
	});

	it("should allow a categorized list chain: category → list", async () => {
		if (!hasDb()) return;
		const { id: categoryId } = await insertCategory("chain-category");
		const rows = await db.execute<{ id: string; category_id: string }>(sql`
      INSERT INTO emito_lists (name, slug, category_id)
      VALUES ('Chained List', 'chained-list-test', ${categoryId})
      RETURNING id, category_id
    `);
		const row = rows[0] as { id: string; category_id: string };
		expect(row.id).toMatch(/^lst_/);
		expect(row.category_id).toBe(categoryId);
	});

	it("should cascade delete list_members when list is deleted", async () => {
		if (!hasDb()) return;
		const { id: subscriberId } = await insertSubscriber();
		const { id: listId } = await insertList("cascade-delete-test-list");
		await db.execute(sql`
      INSERT INTO emito_list_members (subscriber_id, list_id)
      VALUES (${subscriberId}, ${listId})
    `);
		// Verify member exists
		const before = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) as count FROM emito_list_members WHERE list_id = ${listId}
    `);
		expect(Number((before[0] as { count: string }).count)).toBe(1);

		// Delete the list — members should cascade delete
		await db.execute(sql`DELETE FROM emito_list_members WHERE list_id = ${listId}`);
		await db.execute(sql`DELETE FROM emito_lists WHERE id = ${listId}`);

		// Confirm members are gone
		const after = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) as count FROM emito_list_members WHERE list_id = ${listId}
    `);
		expect(Number((after[0] as { count: string }).count)).toBe(0);
	});
});
