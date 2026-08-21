import { boolean, index, pgTable, text, unique } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";
import { ID_PREFIX, generateId } from "../id";

export const emito_preferences = pgTable(
	"emito_preferences",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.preference)),
		subscriberId: text().notNull(),
		workspaceId: text(),
		topicKey: text().notNull(),
		channel: text(),
		enabled: boolean().notNull(),
		...timestamps,
	},
	(table) => [
		unique("emito_preferences_sub_ws_topic_channel_unique")
			.on(table.subscriberId, table.workspaceId, table.topicKey, table.channel)
			.nullsNotDistinct(),
		index("idx_emito_pref_sub").on(table.subscriberId, table.workspaceId),
	],
);
