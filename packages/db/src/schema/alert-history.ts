import { index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";
import { emito_alerts } from "./alerts";

/**
 * Per-firing history of an alert rule.
 *
 * Each row is one firing of the parent `emito_alerts` rule: `triggeredAt` when it
 * crossed the threshold, `triggeredValue` (the observed metric value), `resolvedAt`
 * when it recovered, and the optional acknowledgement trail (`acknowledgedAt`,
 * `acknowledgedByUserId`, `notes`).
 *
 * The `alertId` FK cascades on delete, so removing a rule also removes its history.
 * `triggeredValue` is stored as `numeric` to preserve precision across metric scales.
 */
export const emito_alert_history = pgTable(
	"emito_alert_history",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.alertHistory)),
		alertId: text()
			.notNull()
			.references(() => emito_alerts.id, { onDelete: "cascade" }),
		triggeredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		resolvedAt: timestamp({ withTimezone: true }),
		triggeredValue: numeric(),
		acknowledgedAt: timestamp({ withTimezone: true }),
		acknowledgedByUserId: text(),
		notes: text(),
	},
	(table) => [
		index("idx_emito_ahi_triggered").on(table.triggeredAt.desc()),
		index("idx_emito_ahi_alert").on(table.alertId, table.triggeredAt.desc()),
	],
);
