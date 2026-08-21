/**
 * Test-only helper: install DB-level DEFAULT expressions on every `id` column
 * whose application schema generates the id via Drizzle's `$defaultFn`.
 *
 * The production schema deliberately generates prefixed IDs application-side
 * (see src/id.ts + the `.$defaultFn(...)` on each table). That works for inserts
 * issued through Drizzle's query builder, but the schema-level tests in this
 * package exercise the tables with *raw* SQL (`db.execute(sql\`INSERT ...\`)`)
 * that omits `id` on purpose and asserts the resulting row carries a prefixed
 * id (e.g. `toMatch(/^ntf_/)`). Raw SQL bypasses `$defaultFn`, so against a real
 * PostgreSQL those inserts would fail the NOT NULL constraint.
 *
 * To keep those tests honest without altering the shipped migration, we install
 * an equivalent DB-side default on the test database only. The format mirrors
 * `generateId`: `{prefix}_{32 hex chars}` — `gen_random_uuid()` (built into
 * PostgreSQL 16) supplies a unique hex body. This is never run in production.
 */

import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { ID_PREFIX } from "../src/id";

/** Matches the untyped `drizzle(...)` instances used across the test suite. */
type AnyDrizzleDb = ReturnType<typeof drizzle>;

/** Maps each table with a `$defaultFn` id to its id prefix. */
const TABLE_ID_PREFIX: ReadonlyArray<readonly [table: string, prefix: string]> = [
	["emito_categories", ID_PREFIX.category],
	["emito_topics", ID_PREFIX.topic],
	["emito_subscriptions", ID_PREFIX.topicSubscription],
	["emito_notifications", ID_PREFIX.notification],
	["emito_preferences", ID_PREFIX.preference],
	["emito_workspace_defaults", ID_PREFIX.workspaceDefault],
	["emito_inbox", ID_PREFIX.inbox],
	["emito_push_tokens", ID_PREFIX.pushToken],
	["emito_integrations", ID_PREFIX.integration],
	["emito_suppression", ID_PREFIX.suppression],
	["emito_dead_letters", ID_PREFIX.deadLetter],
	["emito_consents", ID_PREFIX.consent],
	["emito_erasure_log", ID_PREFIX.erasureLog],
	["emito_lists", ID_PREFIX.list],
	["emito_list_members", ID_PREFIX.listMember],
	["emito_webhook_endpoints", ID_PREFIX.webhookEndpoint],
	["emito_webhook_deliveries", ID_PREFIX.webhookDelivery],
	["emito_audit_log", ID_PREFIX.audit],
	["emito_alerts", ID_PREFIX.alert],
	["emito_alert_history", ID_PREFIX.alertHistory],
	["emito_saved_views", ID_PREFIX.savedView],
	["emito_api_keys", ID_PREFIX.apiKey],
	["emito_scheduled_sends", ID_PREFIX.scheduledSend],
	["emito_broadcasts", ID_PREFIX.broadcast],
	["emito_template_overrides", ID_PREFIX.templateOverride],
];

/**
 * Installs the prefixed-id defaults on the given (already-migrated) test
 * database. Safe to call once per file in `beforeAll` after `migrate(...)`.
 * Tables that are absent from the applied migration are skipped silently.
 */
export async function installIdDefaults(db: AnyDrizzleDb): Promise<void> {
	for (const [table, prefix] of TABLE_ID_PREFIX) {
		const exists = await db.execute<{ exists: boolean }>(
			sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists`,
		);
		if (!exists[0]?.exists) continue;

		await db.execute(
			sql.raw(
				`ALTER TABLE "${table}" ALTER COLUMN "id" SET DEFAULT '${prefix}_' || replace(gen_random_uuid()::text, '-', '')`,
			),
		);
	}
}
