import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

export const emito_erasure_log = pgTable(
	"emito_erasure_log",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.erasureLog)),
		subscriberId: text().notNull(),
		reason: text().notNull(),
		requestedBy: text().notNull(),
		requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp({ withTimezone: true }),
		details: jsonb().notNull().default({}),
		providerCascade: jsonb().default({}),
	},
	(table) => [
		check("no_delete_erasure_log", sql`true`),
		index("idx_emito_erl_sub").on(table.subscriberId),
	],
);
