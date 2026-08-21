import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

export const emito_consents = pgTable(
	"emito_consents",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.consent)),
		subscriberId: text().notNull(),
		category: text().notNull(),
		topicSlug: text(),
		consented: boolean().notNull(),
		ipAddress: text(),
		userAgent: text(),
		source: text(),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("idx_emito_consent_sub").on(table.subscriberId, table.category, table.createdAt.desc()),
	],
);
