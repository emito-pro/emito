import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";
import { emito_lists } from "./lists";

/**
 * Send-records of executed broadcasts (distinct from scheduling in `emito_scheduled_sends`).
 *
 * A broadcast targets a `listId` (FK → `emito_lists`) with an `eventKey` + `payload`, and
 * walks `scheduled → running → sent`, or `cancelled`. The lifecycle timestamps
 * (`scheduledFor`, `startedAt`, `completedAt`) and the per-outcome counters
 * (`sentCount`, `deliveredCount`, `failedCount`, `bouncedCount`, `openedCount`,
 * `clickedCount`, `unsubscribedCount`) are updated incrementally as deliveries complete.
 *
 * Counters default to 0 so a freshly created broadcast reports a consistent zeroed funnel.
 */
export const emito_broadcasts = pgTable(
	"emito_broadcasts",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.broadcast)),
		title: text().notNull(),
		listId: text()
			.notNull()
			.references(() => emito_lists.id),
		eventKey: text().notNull(),
		payload: jsonb().notNull().default({}),
		status: text().notNull().default("scheduled"),
		scheduledFor: timestamp({ withTimezone: true }),
		startedAt: timestamp({ withTimezone: true }),
		completedAt: timestamp({ withTimezone: true }),
		totalRecipients: integer().notNull().default(0),
		sentCount: integer().notNull().default(0),
		deliveredCount: integer().notNull().default(0),
		failedCount: integer().notNull().default(0),
		bouncedCount: integer().notNull().default(0),
		openedCount: integer().notNull().default(0),
		clickedCount: integer().notNull().default(0),
		unsubscribedCount: integer().notNull().default(0),
		createdByUserId: text().notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("idx_emito_brc_created").on(table.createdAt.desc()),
		index("idx_emito_brc_list").on(table.listId, table.createdAt.desc()),
		index("idx_emito_brc_status_due").on(table.status, table.scheduledFor.asc()),
	],
);
