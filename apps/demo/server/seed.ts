import {
	type DrizzleDb,
	createDrizzleClient,
	emito_subscribers,
	emito_workspace_defaults,
} from "@emito/db";
import { sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://emito:emito@localhost:5432/emito_demo";

/**
 * Seed the demo's baseline fixtures into an existing database.
 *
 * Idempotent — every insert uses `ON CONFLICT DO NOTHING`, so re-running (e.g. on
 * each container boot) is safe. Creates the three demo subscribers and the
 * `ws_acme-trading` workspace channel defaults. Performs no connection management
 * and never calls `process.exit`, so it can be awaited inline during server boot
 * (see {@link import("./index.js")}) as well as from the CLI wrapper below.
 *
 * @param db - A live Drizzle client (the same one the server runs on).
 * @returns Resolves once the fixtures are committed.
 */
export async function seedDemo(db: DrizzleDb): Promise<void> {
	console.log("[seed] Creating subscribers...");
	// The trading platform's own user directory (`DEMO_USERS` in `auth.ts`) carries
	// the human names, so seed them into the subscriber metadata too — that way any
	// surface reading subscribers back shows "Alice Chen" rather than a blank name.
	// On conflict, merge the display name into the existing metadata bag (rather than
	// DO NOTHING) so a subscriber row created by an EARLIER demo build — before this
	// seed carried names — gets its name backfilled on the next boot. `||` is the
	// Postgres jsonb concat (shallow merge), so any other metadata keys are kept.
	// Still fully idempotent: re-running with the same names is a no-op write.
	await db
		.insert(emito_subscribers)
		.values([
			{
				id: "trader_alice",
				email: "alice@demo.emito.dev",
				lang: "en",
				metadata: { name: "Alice Chen" },
			},
			{
				id: "trader_bob",
				email: "bob@demo.emito.dev",
				lang: "en",
				metadata: { name: "Bob Martinez" },
			},
			{
				id: "admin_charlie",
				email: "charlie@demo.emito.dev",
				lang: "en",
				metadata: { name: "Charlie Park" },
			},
		])
		.onConflictDoUpdate({
			target: emito_subscribers.id,
			set: { metadata: sql`${emito_subscribers.metadata} || excluded.metadata` },
		});

	console.log("[seed] Creating workspace defaults for 'ws_acme-trading'...");
	await db
		.insert(emito_workspace_defaults)
		.values([
			{ workspaceId: "ws_acme-trading", topicKey: "order.fill", channel: "email", enabled: true },
			{ workspaceId: "ws_acme-trading", topicKey: "order.fill", channel: "inApp", enabled: true },
			{ workspaceId: "ws_acme-trading", topicKey: "order.fill", channel: "push", enabled: true },
			{ workspaceId: "ws_acme-trading", topicKey: "price.alert", channel: "inApp", enabled: true },
			{ workspaceId: "ws_acme-trading", topicKey: "price.alert", channel: "push", enabled: true },
			{ workspaceId: "ws_acme-trading", topicKey: "price.alert", channel: "sms", enabled: false },
			{
				workspaceId: "ws_acme-trading",
				topicKey: "security.alert",
				channel: "email",
				enabled: true,
				isMandatory: true,
			},
			{
				workspaceId: "ws_acme-trading",
				topicKey: "security.alert",
				channel: "inApp",
				enabled: true,
				isMandatory: true,
			},
			{ workspaceId: "ws_acme-trading", topicKey: "team.invite", channel: "email", enabled: true },
			{ workspaceId: "ws_acme-trading", topicKey: "team.invite", channel: "inApp", enabled: true },
		])
		.onConflictDoNothing();

	console.log("[seed] Done.");
}

/**
 * CLI entry point — preserves the `pnpm --filter @emito/demo seed` behaviour:
 * connect, seed, and exit. Only runs when this module is executed directly, so
 * importing {@link seedDemo} from the server never triggers a `process.exit`.
 */
async function main(): Promise<void> {
	console.log("[seed] Connecting to database...");
	const db = createDrizzleClient(DATABASE_URL);
	await seedDemo(db);
	process.exit(0);
}

const isCliEntry = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
	main().catch((err) => {
		console.error("[seed] Failed:", err);
		process.exit(1);
	});
}
