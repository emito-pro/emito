import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

export const emito_push_tokens = pgTable(
	"emito_push_tokens",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.pushToken)),
		subscriberId: text().notNull(),
		token: text().notNull(),
		platform: text().notNull(),
		deviceName: text(),
		active: boolean().notNull().default(true),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		lastUsedAt: timestamp({ withTimezone: true }),
	},
	(table) => [
		index("idx_emito_push_active").on(table.subscriberId).where(sql`${table.active} = true`),
	],
);
