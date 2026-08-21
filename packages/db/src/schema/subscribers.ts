import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";

export const emito_subscribers = pgTable(
	"emito_subscribers",
	{
		id: text().primaryKey(),
		email: text(),
		phone: text(),
		lang: text().default("en"),
		locale: text(),
		timezone: text(),
		globallyUnsubscribed: boolean().default(false),
		globallyUnsubscribedAt: timestamp({ withTimezone: true }),
		metadata: jsonb().default({}),
		erasedAt: timestamp({ withTimezone: true }),
		...timestamps,
	},
	(table) => [
		index("idx_emito_sub_email").on(table.email),
		index("idx_emito_sub_erased").on(table.erasedAt).where(sql`${table.erasedAt} IS NOT NULL`),
	],
);
