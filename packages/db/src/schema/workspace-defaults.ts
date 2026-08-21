import { boolean, pgTable, text, unique } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";
import { ID_PREFIX, generateId } from "../id";

export const emito_workspace_defaults = pgTable(
	"emito_workspace_defaults",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.workspaceDefault)),
		workspaceId: text().notNull(),
		topicKey: text().notNull(),
		channel: text(),
		enabled: boolean().notNull().default(true),
		isMandatory: boolean().notNull().default(false),
		...timestamps,
	},
	(table) => [
		unique("emito_workspace_defaults_ws_topic_channel_unique").on(
			table.workspaceId,
			table.topicKey,
			table.channel,
		),
	],
);
