import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";
import { ID_PREFIX, generateId } from "../id";

/**
 * Future-dated send-jobs (scheduled broadcasts and per-event scheduled sends).
 *
 * `kind` distinguishes `broadcast` from `event`. `eventKey` + `payload` describe what to
 * send; `recipients` (`{subscriberId?, listSlug?, query?}`) describes to whom. `scheduledFor`
 * + `timezone` (IANA) define when. `status` walks `pending → running → complete`, or
 * `cancelled` (with `cancelledAt` / `cancelledByUserId` recording the cancellation).
 *
 * The partial index on `scheduledFor WHERE status='pending'` lets the scheduler poll only
 * due, un-run jobs cheaply; the broader `(status, scheduledFor)` index serves admin listing.
 */
export const emito_scheduled_sends = pgTable(
	"emito_scheduled_sends",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.scheduledSend)),
		kind: text().notNull(),
		eventKey: text().notNull(),
		payload: jsonb().notNull().default({}),
		recipients: jsonb().notNull().default({}),
		scheduledFor: timestamp({ withTimezone: true }).notNull(),
		timezone: text().notNull(),
		status: text().notNull().default("pending"),
		createdByUserId: text().notNull(),
		cancelledAt: timestamp({ withTimezone: true }),
		cancelledByUserId: text(),
		...timestamps,
	},
	(table) => [
		index("idx_emito_sch_status_due").on(table.status, table.scheduledFor.asc()),
		index("idx_emito_sch_scheduled").on(table.scheduledFor.desc()),
		index("idx_emito_sch_pending_due")
			.on(table.scheduledFor.asc())
			.where(sql`${table.status} = 'pending'`),
	],
);
