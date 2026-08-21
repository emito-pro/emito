import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";
import { ID_PREFIX, generateId } from "../id";

/**
 * Alert rule definitions evaluated against current metrics.
 *
 * A rule binds a `metric` (e.g. `bounce_rate`, `dlq_depth`, `latency_p95`) to a
 * `condition` (`{operator, threshold, window, compositeWith?}`) and a `severity`.
 * When fired, `notify` (`{channels, targets}`) determines delivery, optionally with
 * `escalation` and `maintenance` windows. `enabled` gates evaluation; `lastTriggeredAt`
 * records the most recent firing. Each firing also appends to `emito_alert_history`.
 *
 * Free-form rule shapes (`condition`, `notify`, `escalation`, `maintenance`) are stored
 * as JSONB and validated by the Zod schemas at the endpoint boundary.
 *
 * `version` is an optimistic-concurrency token: it starts at 1 and the repository bumps it
 * on every edit, so a stale client patch (carrying a mismatched expected version) is rejected.
 */
export const emito_alerts = pgTable(
	"emito_alerts",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.alert)),
		name: text().notNull(),
		metric: text().notNull(),
		condition: jsonb().notNull(),
		severity: text().notNull(),
		notify: jsonb().notNull(),
		escalation: jsonb(),
		maintenance: jsonb(),
		enabled: boolean().notNull().default(true),
		lastTriggeredAt: timestamp({ withTimezone: true }),
		version: integer().notNull().default(1),
		...timestamps,
	},
	(table) => [
		index("idx_emito_alr_enabled_metric")
			.on(table.enabled, table.metric)
			.where(sql`${table.enabled} = true`),
	],
);
