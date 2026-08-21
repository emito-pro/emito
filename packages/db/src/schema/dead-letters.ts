import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

export const emito_dead_letters = pgTable(
	"emito_dead_letters",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.deadLetter)),
		notificationId: text().notNull(),
		subscriberId: text().notNull(),
		eventType: text().notNull(),
		channel: text().notNull(),
		attempts: jsonb().notNull(),
		payload: jsonb().notNull(),
		exhaustedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		resolvedAt: timestamp({ withTimezone: true }),
		resolution: text(),
	},
	(table) => [
		index("idx_emito_dlq_unresolved")
			.on(table.exhaustedAt.desc())
			.where(sql`${table.resolvedAt} IS NULL`),
	],
);
