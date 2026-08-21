import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

export const emito_integrations = pgTable("emito_integrations", {
	id: text()
		.primaryKey()
		.$defaultFn(() => generateId(ID_PREFIX.integration)),
	ownerId: text().notNull(),
	subscriberId: text(),
	name: text(),
	channel: text().notNull(),
	events: text().array(),
	config: jsonb().notNull(),
	secretFields: text().array(),
	active: boolean().notNull().default(true),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
