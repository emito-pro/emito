import type {
	ApiPage,
	AuditActorKind,
	AuditLogEntry,
	AuditLogFilters,
	AuditLogRecord,
	AuditLogRepository,
	AuditSeverity,
	RepositoryTx,
} from "@emito/core";
import { and, desc, eq, gte, ilike, lt, lte, sql } from "drizzle-orm";
import { emito_audit_log } from "../schema/audit-log";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";

/**
 * Drizzle implementation of {@link AuditLogRepository} (append-only audit log).
 *
 * `create` accepts an optional transaction handle so the audit write joins the caller's
 * mutation transaction — if the audit insert fails the mutation rolls back. `list` filters
 * via parameterised `eq`/`like`/`gte`/`lte`, orders newest-first by `createdAt`, over-fetches
 * `limit + 1` to derive `hasMore`, and runs a gated `COUNT(*)` for `total`.
 */
export class DrizzleAuditLogRepository implements AuditLogRepository {
	constructor(private readonly db: DrizzleDb) {}

	async create(entry: AuditLogEntry, tx?: RepositoryTx): Promise<AuditLogRecord> {
		const executor = (tx as DrizzleDb | undefined) ?? this.db;
		const [row] = await executor
			.insert(emito_audit_log)
			.values({
				actorUserId: entry.actorUserId,
				actorKind: entry.actorKind,
				action: entry.action,
				resourceType: entry.resourceType,
				resourceId: entry.resourceId ?? null,
				severity: entry.severity,
				beforeState: entry.beforeState ?? null,
				afterState: entry.afterState ?? null,
				requestId: entry.requestId,
				ip: entry.ip,
				userAgent: entry.userAgent ?? null,
				apiKeyId: entry.apiKeyId ?? null,
				metadata: entry.metadata ?? {},
			})
			.returning();
		return this.mapRow(row);
	}

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AuditLogFilters;
	}): Promise<ApiPage<AuditLogRecord>> {
		const limit = normalizeAdminLimit(opts.limit);
		const cursorDate = decodeAdminCursorDate(opts.cursor);
		const where = this.buildWhere(opts.filters, cursorDate);

		const rows = await this.db
			.select()
			.from(emito_audit_log)
			.where(where)
			.orderBy(desc(emito_audit_log.createdAt))
			.limit(limit + 1);

		const total = await this.count(opts.filters);
		return buildAdminPage(
			rows.map((r) => this.mapRow(r)),
			limit,
			total,
			(r) => r.createdAt,
		);
	}

	async findById(id: string): Promise<AuditLogRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_audit_log)
			.where(eq(emito_audit_log.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	private async count(filters?: AuditLogFilters): Promise<number> {
		const where = this.buildWhere(filters, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_audit_log)
			.where(where);
		return row?.value ?? 0;
	}

	private buildWhere(filters: AuditLogFilters | undefined, cursorDate: Date | undefined) {
		const conditions = [];
		if (filters?.actor !== undefined) {
			conditions.push(ilike(emito_audit_log.actorUserId, `%${filters.actor}%`));
		}
		if (filters?.resourceType !== undefined) {
			conditions.push(eq(emito_audit_log.resourceType, filters.resourceType));
		}
		if (filters?.resourceId !== undefined) {
			conditions.push(eq(emito_audit_log.resourceId, filters.resourceId));
		}
		if (filters?.severity !== undefined) {
			conditions.push(eq(emito_audit_log.severity, filters.severity));
		}
		if (filters?.action !== undefined) {
			conditions.push(eq(emito_audit_log.action, filters.action));
		}
		if (filters?.from !== undefined) {
			conditions.push(gte(emito_audit_log.createdAt, filters.from));
		}
		if (filters?.to !== undefined) {
			conditions.push(lte(emito_audit_log.createdAt, filters.to));
		}
		if (cursorDate !== undefined) {
			conditions.push(lt(emito_audit_log.createdAt, cursorDate));
		}
		return conditions.length > 0 ? and(...conditions) : undefined;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): AuditLogRecord {
		return {
			id: row.id,
			actorUserId: row.actorUserId,
			actorKind: row.actorKind as AuditActorKind,
			action: row.action,
			resourceType: row.resourceType,
			resourceId: row.resourceId ?? null,
			severity: row.severity as AuditSeverity,
			beforeState: (row.beforeState as Record<string, unknown> | null) ?? null,
			afterState: (row.afterState as Record<string, unknown> | null) ?? null,
			requestId: row.requestId,
			ip: row.ip,
			userAgent: row.userAgent ?? null,
			apiKeyId: row.apiKeyId ?? null,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			createdAt: row.createdAt,
		};
	}
}
