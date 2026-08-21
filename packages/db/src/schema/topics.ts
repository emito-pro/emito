import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";
import { emito_categories } from "./categories";

export const emito_topics = pgTable(
	"emito_topics",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.topic)),
		categoryId: text()
			.notNull()
			.references(() => emito_categories.id),
		slug: text().notNull().unique(),
		name: text().notNull(),
		description: text(),
		defaultSubscribed: boolean().default(true),
		userConfigurable: boolean().default(true),
		sortOrder: integer().default(0),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	// FK-supporting index: topics-by-category lookups (and a category delete's child
	// scan) would otherwise full-scan the topics table.
	(table) => [index("idx_emito_top_category").on(table.categoryId)],
);
