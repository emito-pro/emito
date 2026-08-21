import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";
import { emito_lists } from "./lists";
import { emito_subscribers } from "./subscribers";

export const emito_list_members = pgTable(
	"emito_list_members",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.listMember)),
		subscriberId: text()
			.notNull()
			.references(() => emito_subscribers.id),
		listId: text()
			.notNull()
			.references(() => emito_lists.id),
		status: text().notNull().default("unconfirmed"),
		source: text(),
		subscribedAt: timestamp({ withTimezone: true }),
		confirmedAt: timestamp({ withTimezone: true }),
		unsubscribedAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		unique("emito_list_members_sub_list_unique").on(table.subscriberId, table.listId),
		index("idx_emito_lmb_list")
			.on(table.listId, table.status)
			.where(sql`${table.status} = 'confirmed'`),
		// Serves the members grid's keyset page: `WHERE list_id = ? [AND status = ?]
		// ORDER BY created_at DESC`. The partial `(list_id, status)` index above answers
		// the confirmed-count path but carries no `created_at`, so without this the page
		// query falls back to a Seq Scan + sort on a large membership. The leading
		// `list_id` column also fully supports the `list_id` foreign key.
		index("idx_emito_lmb_list_created").on(table.listId, table.createdAt.desc()),
	],
);
