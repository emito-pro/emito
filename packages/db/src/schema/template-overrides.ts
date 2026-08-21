import { index, integer, pgTable, text, unique } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";
import { ID_PREFIX, generateId } from "../id";

/**
 * Custom template source overriding the built-in `defaultTemplates` per
 * (event, channel, locale).
 *
 * Each row is one immutable version of a template: `source` is the body, `channel`
 * (`email`|`sms`|`push`|`inApp`) and `locale` (BCP-47) scope it, and `compiledWarning`
 * captures a non-fatal compile diagnostic if the source fails to compile cleanly.
 * `version` is incremented per (event, channel, locale) so history is retained — editors
 * append a new version rather than mutating an existing one.
 *
 * The unique constraint on `(eventKey, channel, locale, version)` prevents duplicate
 * versions; the lookup index (same columns, version DESC) resolves the latest override fast.
 */
export const emito_template_overrides = pgTable(
	"emito_template_overrides",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.templateOverride)),
		eventKey: text().notNull(),
		channel: text().notNull(),
		locale: text().notNull(),
		source: text().notNull(),
		compiledWarning: text(),
		version: integer().notNull(),
		createdByUserId: text().notNull(),
		updatedByUserId: text().notNull(),
		...timestamps,
	},
	(table) => [
		unique("emito_template_overrides_event_channel_locale_version_unique").on(
			table.eventKey,
			table.channel,
			table.locale,
			table.version,
		),
		index("idx_emito_tmo_lookup").on(
			table.eventKey,
			table.channel,
			table.locale,
			table.version.desc(),
		),
	],
);
