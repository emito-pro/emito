import {
	type AnyPgColumn,
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

export const emito_categories = pgTable(
	"emito_categories",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.category)),
		slug: text().notNull().unique(),
		name: text().notNull(),
		description: text(),
		legalClass: text().notNull(),
		defaultPolicy: text().notNull(),
		userConfigurable: boolean().default(true),
		sortOrder: integer().default(0),
		parentId: text().references((): AnyPgColumn => emito_categories.id),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	// FK-supporting index: a self-referential parent lookup (and a parent delete's
	// child scan) would otherwise full-scan the category tree.
	(table) => [index("idx_emito_cat_parent").on(table.parentId)],
);
