import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";
import { ID_PREFIX, generateId } from "../id";

export const emito_suppression = pgTable(
	"emito_suppression",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.suppression)),
		address: text().notNull(),
		channel: text().notNull(),
		reason: text().notNull(),
		provider: text(),
		providerMsgId: text(),
		consecutiveSoft: integer().default(0),
		...timestamps,
		archivedAt: timestamp({ withTimezone: true }),
	},
	(table) => [
		uniqueIndex("emito_suppression_address_channel_active")
			.on(table.address, table.channel)
			.where(sql`${table.archivedAt} IS NULL`),
		index("idx_emito_sup_lookup").on(table.address, table.channel),
	],
);
