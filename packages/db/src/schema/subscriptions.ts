import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";
import { emito_subscribers } from "./subscribers";
import { emito_topics } from "./topics";

export const emito_subscriptions = pgTable(
	"emito_subscriptions",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.topicSubscription)),
		subscriberId: text()
			.notNull()
			.references(() => emito_subscribers.id),
		topicId: text()
			.notNull()
			.references(() => emito_topics.id),
		channel: text().notNull(),
		status: text().notNull().default("opted_in"),
		consentMechanism: text(),
		consentIp: text(),
		consentAt: timestamp({ withTimezone: true }),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		unique("emito_subscriptions_sub_topic_channel_unique").on(
			table.subscriberId,
			table.topicId,
			table.channel,
		),
		// FK-supporting index: the composite unique above leads with `subscriberId`, so
		// it does not serve `topicId` lookups (subscribers-of-a-topic, or a topic delete's
		// child scan) — this index covers the `topicId` foreign key directly.
		index("idx_emito_subc_topic").on(table.topicId),
	],
);
