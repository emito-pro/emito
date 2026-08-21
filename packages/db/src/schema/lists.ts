import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";
import { ID_PREFIX, generateId } from "../id";
import { emito_categories } from "./categories";

export const emito_lists = pgTable(
	"emito_lists",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.list)),
		name: text().notNull(),
		slug: text().notNull().unique(),
		description: text(),
		optinType: text().notNull().default("single"),
		visibility: text().notNull().default("private"),
		categoryId: text().references(() => emito_categories.id),
		memberCount: integer().default(0),
		archivedAt: timestamp({ withTimezone: true }),
		...timestamps,
	},
	// FK-supporting index: lists-by-category lookups (and a category delete's child
	// scan) would otherwise full-scan the lists table.
	(table) => [index("idx_emito_lst_category").on(table.categoryId)],
);
