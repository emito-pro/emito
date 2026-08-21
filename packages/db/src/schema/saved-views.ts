import { jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";
import { ID_PREFIX, generateId } from "../id";

/**
 * Cross-page named filter sets persisted server-side.
 *
 * A saved view binds a `name` to a `page` (e.g. `activity`, `subscribers`,
 * `dead-letters`) and a page-specific `filters` JSONB blob. `scope` is `private`
 * (visible only to the creator) or `team` (shared). `createdByUserId` records ownership.
 *
 * The unique constraint on `(createdByUserId, name, page)` stops a single operator from
 * creating two views with the same name on the same page; different users may reuse names.
 */
export const emito_saved_views = pgTable(
	"emito_saved_views",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.savedView)),
		name: text().notNull(),
		page: text().notNull(),
		filters: jsonb().notNull().default({}),
		scope: text().notNull().default("private"),
		createdByUserId: text().notNull(),
		...timestamps,
	},
	(table) => [
		unique("emito_saved_views_user_name_page_unique").on(
			table.createdByUserId,
			table.name,
			table.page,
		),
	],
);
