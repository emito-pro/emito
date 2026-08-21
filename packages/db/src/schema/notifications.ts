import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

export const emito_notifications = pgTable(
	"emito_notifications",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.notification)),
		subscriberId: text().notNull(),
		workspaceId: text(),
		eventType: text().notNull(),
		category: text().notNull(),
		channel: text().notNull(),
		status: text().notNull().default("pending"),
		deliveryAddress: text(),
		provider: text(),
		providerMsgId: text(),
		errorMessage: text(),
		errorClassification: text(),
		attempts: integer().default(0),
		payload: jsonb().default({}),
		metadata: jsonb().default({}),
		idempotencyKey: text(),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		sentAt: timestamp({ withTimezone: true }),
		deliveredAt: timestamp({ withTimezone: true }),
		openedAt: timestamp({ withTimezone: true }),
		clickedAt: timestamp({ withTimezone: true }),
		failedAt: timestamp({ withTimezone: true }),
	},
	(table) => [
		unique("emito_notifications_idempotency_key_unique").on(table.idempotencyKey),
		index("idx_emito_notif_sub").on(table.subscriberId, table.createdAt.desc()),
		index("idx_emito_notif_event").on(table.eventType, table.createdAt.desc()),
		index("idx_emito_notif_status")
			.on(table.status)
			.where(sql`${table.status} NOT IN ('delivered', 'opened', 'clicked')`),
		index("idx_emito_notif_ws")
			.on(table.workspaceId, table.createdAt.desc())
			.where(sql`${table.workspaceId} IS NOT NULL`),
		index("idx_emito_notif_provider_msg_id")
			.on(table.providerMsgId)
			.where(sql`${table.providerMsgId} IS NOT NULL`),
	],
);
