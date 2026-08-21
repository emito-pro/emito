import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ID_PREFIX, generateId } from "../id";

/**
 * Append-only event log of every mutating admin action.
 *
 * Each row records who fired an action (`actorUserId` + `actorKind`), what they
 * changed (`action`, `resourceType`, `resourceId`), the before/after JSON snapshots,
 * and request-tracing context (`requestId`, `ip`, `userAgent`). Mutating endpoints
 * write here inside the same Drizzle transaction as the mutation, so an audit-write
 * failure rolls the mutation back.
 *
 * Append-only is enforced at the database level by BEFORE UPDATE / BEFORE DELETE
 * row triggers (`trg_emito_audit_log_no_update` / `trg_emito_audit_log_no_delete`),
 * both calling `emito_audit_log_immutable()` which raises with SQLSTATE `EM100`.
 * Added via a hand-written migration
 * `drizzle/0006_audit_log_immutability.sql` (drizzle-kit cannot emit triggers).
 * The `no_delete_audit_log` CHECK (body `sql\`true\``) is retained as documentation
 * of intent — it is a no-op constraint, the triggers do the real enforcement. Note
 * the triggers are row-level, so `TRUNCATE` (statement-level) still succeeds, which
 * is required for the per-test `TRUNCATE ... CASCADE` isolation reset. `resourceId`
 * is nullable for bulk operations that span many resources.
 */
export const emito_audit_log = pgTable(
	"emito_audit_log",
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId(ID_PREFIX.audit)),
		actorUserId: text().notNull(),
		actorKind: text().notNull(),
		action: text().notNull(),
		resourceType: text().notNull(),
		resourceId: text(),
		severity: text().notNull(),
		beforeState: jsonb(),
		afterState: jsonb(),
		requestId: text().notNull(),
		ip: text().notNull(),
		userAgent: text(),
		apiKeyId: text(),
		metadata: jsonb().notNull().default({}),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		check("no_delete_audit_log", sql`true`),
		index("idx_emito_aud_created").on(table.createdAt.desc()),
		index("idx_emito_aud_actor").on(table.actorUserId, table.createdAt.desc()),
		index("idx_emito_aud_resource").on(
			table.resourceType,
			table.resourceId,
			table.createdAt.desc(),
		),
		index("idx_emito_aud_high_severity").on(table.severity).where(sql`${table.severity} = 'high'`),
	],
);
