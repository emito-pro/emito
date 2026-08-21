import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

export const emito_inbox = pgTable(
	"emito_inbox",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.inbox)),
		subscriberId: text().notNull(),
		workspaceId: text(),
		eventType: text().notNull(),
		category: text().notNull(),
		topicKey: text(),
		subject: text(),
		body: text().notNull(),
		avatar: text(),
		actionUrl: text(),
		primaryActionLabel: text(),
		primaryActionUrl: text(),
		secondaryActionLabel: text(),
		secondaryActionUrl: text(),
		data: jsonb().default({}),
		readAt: timestamp({ withTimezone: true }),
		archivedAt: timestamp({ withTimezone: true }),
		snoozedUntil: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("idx_emito_inbox_sub").on(table.subscriberId, table.createdAt.desc()),
		index("idx_emito_inbox_unread")
			.on(table.subscriberId, table.readAt)
			.where(sql`${table.readAt} IS NULL`),
		index("idx_emito_inbox_ws")
			.on(table.subscriberId, table.workspaceId, table.createdAt.desc())
			.where(sql`${table.workspaceId} IS NOT NULL`),
	],
);
