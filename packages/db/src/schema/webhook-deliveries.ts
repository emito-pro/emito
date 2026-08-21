import { integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";
import { emito_webhook_endpoints } from "./webhook-endpoints";

export const emito_webhook_deliveries = pgTable(
	"emito_webhook_deliveries",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.webhookDelivery)),
		endpointId: text()
			.notNull()
			.references(() => emito_webhook_endpoints.id),
		eventId: text().notNull(),
		eventType: text().notNull(),
		status: text().notNull().default("pending"),
		attempts: integer().default(0),
		lastAttemptAt: timestamp({ withTimezone: true }),
		nextRetryAt: timestamp({ withTimezone: true }),
		responseStatus: integer(),
		responseBody: text(),
		payload: jsonb().notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		unique("emito_webhook_deliveries_endpoint_event_unique").on(table.endpointId, table.eventId),
	],
);
