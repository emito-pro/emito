import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

/**
 * Admin-issued API keys for programmatic access.
 *
 * The cleartext key is never stored: `keyHash` holds the bcrypt (10-round) hash and
 * `keyPrefix` holds the first 8 cleartext chars for a cheap lookup before the constant-time
 * hash compare. `scope` is `full` or `readonly`. `revokedAt` is the soft-delete marker;
 * a revoked key keeps its row for audit but stops authenticating.
 *
 * The partial unique index on `keyPrefix WHERE revoked_at IS NULL` guarantees at most one
 * active key per prefix while allowing the same prefix to recur across revoked rows. A
 * separate non-unique lookup index on `keyPrefix` keeps revoked-inclusive scans fast.
 */
export const emito_api_keys = pgTable(
	"emito_api_keys",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.apiKey)),
		name: text().notNull(),
		keyHash: text().notNull(),
		keyPrefix: text().notNull(),
		scope: text().notNull(),
		createdByUserId: text().notNull(),
		lastUsedAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		revokedAt: timestamp({ withTimezone: true }),
	},
	(table) => [
		uniqueIndex("emito_api_keys_active_prefix_unique")
			.on(table.keyPrefix)
			.where(sql`${table.revokedAt} IS NULL`),
		index("idx_emito_apk_prefix").on(table.keyPrefix),
	],
);
