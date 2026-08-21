import type {
	AlertHistoryCreate,
	AlertHistoryFilters,
	AlertHistoryRecord,
	AlertHistoryRepository,
	ApiPage,
} from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { and, desc, eq, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { emito_alert_history } from "../schema/alert-history";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";

/**
 * Drizzle implementation of {@link AlertHistoryRepository} (per-firing alert history).
 *
 * `triggeredValue` is a Postgres `numeric` (returned as a string by the driver) so it is
 * parsed to a `number` on read and serialized to a string on write to preserve precision.
 * The `acknowledged` filter keys off `acknowledgedAt IS [NOT] NULL`. `activeAlerts` returns
 * un-resolved firings newest-first.
 */
export class DrizzleAlertHistoryRepository implements AlertHistoryRepository {
	constructor(private readonly db: DrizzleDb) {}

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AlertHistoryFilters;
	}): Promise<ApiPage<AlertHistoryRecord>> {
		const limit = normalizeAdminLimit(opts.limit);
		const cursorDate = decodeAdminCursorDate(opts.cursor);
		const where = this.buildWhere(opts.filters, cursorDate);

		const rows = await this.db
			.select()
			.from(emito_alert_history)
			.where(where)
			.orderBy(desc(emito_alert_history.triggeredAt))
			.limit(limit + 1);

		const total = await this.count(opts.filters);
		return buildAdminPage(
			rows.map((r) => this.mapRow(r)),
			limit,
			total,
			(r) => r.triggeredAt,
		);
	}

	async findById(id: string): Promise<AlertHistoryRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_alert_history)
			.where(eq(emito_alert_history.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async create(entry: AlertHistoryCreate): Promise<AlertHistoryRecord> {
		const [row] = await this.db
			.insert(emito_alert_history)
			.values({
				alertId: entry.alertId,
				triggeredAt: entry.triggeredAt ?? new Date(),
				triggeredValue:
					entry.triggeredValue === undefined || entry.triggeredValue === null
						? null
						: String(entry.triggeredValue),
			})
			.returning();
		return this.mapRow(row);
	}

	async acknowledge(id: string, userId: string, notes?: string): Promise<AlertHistoryRecord> {
		const [row] = await this.db
			.update(emito_alert_history)
			.set({
				acknowledgedAt: new Date(),
				acknowledgedByUserId: userId,
				notes: notes ?? null,
			})
			.where(eq(emito_alert_history.id, id))
			.returning();
		if (!row) throw this.notFound(id);
		return this.mapRow(row);
	}

	async resolve(id: string, at: Date): Promise<AlertHistoryRecord> {
		const [row] = await this.db
			.update(emito_alert_history)
			.set({ resolvedAt: at })
			.where(eq(emito_alert_history.id, id))
			.returning();
		if (!row) throw this.notFound(id);
		return this.mapRow(row);
	}

	async activeAlerts(): Promise<readonly AlertHistoryRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_alert_history)
			.where(isNull(emito_alert_history.resolvedAt))
			.orderBy(desc(emito_alert_history.triggeredAt));
		return rows.map((r) => this.mapRow(r));
	}

	private notFound(id: string): EmitoError {
		return new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
			message: `Alert history "${id}" not found`,
			isRetryable: false,
			context: { id },
		});
	}

	private async count(filters?: AlertHistoryFilters): Promise<number> {
		const where = this.buildWhere(filters, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_alert_history)
			.where(where);
		return row?.value ?? 0;
	}

	private buildWhere(filters: AlertHistoryFilters | undefined, cursorDate: Date | undefined) {
		const conditions = [];
		if (filters?.alertId !== undefined) {
			conditions.push(eq(emito_alert_history.alertId, filters.alertId));
		}
		if (filters?.acknowledged === true) {
			conditions.push(isNotNull(emito_alert_history.acknowledgedAt));
		} else if (filters?.acknowledged === false) {
			conditions.push(isNull(emito_alert_history.acknowledgedAt));
		}
		if (filters?.from !== undefined) {
			conditions.push(gte(emito_alert_history.triggeredAt, filters.from));
		}
		if (filters?.to !== undefined) {
			conditions.push(lte(emito_alert_history.triggeredAt, filters.to));
		}
		if (cursorDate !== undefined) {
			conditions.push(lt(emito_alert_history.triggeredAt, cursorDate));
		}
		return conditions.length > 0 ? and(...conditions) : undefined;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): AlertHistoryRecord {
		const raw = row.triggeredValue;
		const triggeredValue = raw === null || raw === undefined ? null : Number(raw);
		return {
			id: row.id,
			alertId: row.alertId,
			triggeredAt: row.triggeredAt,
			resolvedAt: row.resolvedAt ?? null,
			triggeredValue,
			acknowledgedAt: row.acknowledgedAt ?? null,
			acknowledgedByUserId: row.acknowledgedByUserId ?? null,
			notes: row.notes ?? null,
		};
	}
}
