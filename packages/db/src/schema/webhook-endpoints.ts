import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";
import { ID_PREFIX, generateId } from "../id";

export const emito_webhook_endpoints = pgTable("emito_webhook_endpoints", {
	id: text()
		.primaryKey()
		.$defaultFn(() => generateId(ID_PREFIX.webhookEndpoint)),
	ownerId: text().notNull(),
	url: text().notNull(),
	events: text().array().notNull(),
	signingSecret: text().notNull(),
	description: text(),
	status: text().notNull().default("active"),
	consecutiveFailures: integer().default(0),
	lastDeliveryAt: timestamp({ withTimezone: true }),
	lastFailureAt: timestamp({ withTimezone: true }),
	...timestamps,
});
