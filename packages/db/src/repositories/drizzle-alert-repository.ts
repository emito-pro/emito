import type {
	AlertCreate,
	AlertFilters,
	AlertPatch,
	AlertRecord,
	AlertRepository,
	AlertSeverity,
	ApiPage,
} from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { emito_alerts } from "../schema/alerts";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";

/**
 * Drizzle implementation of {@link AlertRepository}.
 *
 * `update` supports optimistic concurrency: when `expectedVersion` is supplied it is folded
 * into the WHERE clause, and a zero-row update means either the id is unknown or the version
 * is stale — disambiguated by a follow-up `findById`. Every successful update bumps `version`;
 * `markTriggered` writes `lastTriggeredAt` without bumping it.
 */
export class DrizzleAlertRepository implements AlertRepository {
	constructor(private readonly db: DrizzleDb) {}

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AlertFilters;
	}): Promise<ApiPage<AlertRecord>> {
		const limit = normalizeAdminLimit(opts.limit);
		const cursorDate = decodeAdminCursorDate(opts.cursor);
		const where = this.buildWhere(opts.filters, cursorDate);

		const rows = await this.db
			.select()
			.from(emito_alerts)
			.where(where)
			.orderBy(desc(emito_alerts.createdAt))
			.limit(limit + 1);

		const total = await this.count(opts.filters);
		return buildAdminPage(
			rows.map((r) => this.mapRow(r)),
			limit,
			total,
			(r) => r.createdAt,
		);
	}

	async findById(id: string): Promise<AlertRecord | null> {
		const [row] = await this.db.select().from(emito_alerts).where(eq(emito_alerts.id, id)).limit(1);
		return row ? this.mapRow(row) : null;
	}

	async create(input: AlertCreate): Promise<AlertRecord> {
		const [row] = await this.db
			.insert(emito_alerts)
			.values({
				name: input.name,
				metric: input.metric,
				condition: input.condition,
				severity: input.severity,
				notify: input.notify,
				escalation: input.escalation ?? null,
				maintenance: input.maintenance ?? null,
				enabled: input.enabled ?? true,
				version: 1,
			})
			.returning();
		return this.mapRow(row);
	}

	async update(
		id: string,
		patch: AlertPatch,
		opts?: { expectedVersion?: number },
	): Promise<AlertRecord> {
		const setValues: Record<string, unknown> = {
			updatedAt: new Date(),
			version: sql`${emito_alerts.version} + 1`,
		};
		if (patch.name !== undefined) setValues.name = patch.name;
		if (patch.metric !== undefined) setValues.metric = patch.metric;
		if (patch.condition !== undefined) setValues.condition = patch.condition;
		if (patch.severity !== undefined) setValues.severity = patch.severity;
		if (patch.notify !== undefined) setValues.notify = patch.notify;
		if (patch.escalation !== undefined) setValues.escalation = patch.escalation;
		if (patch.maintenance !== undefined) setValues.maintenance = patch.maintenance;
		if (patch.enabled !== undefined) setValues.enabled = patch.enabled;

		const where =
			opts?.expectedVersion !== undefined
				? and(eq(emito_alerts.id, id), eq(emito_alerts.version, opts.expectedVersion))
				: eq(emito_alerts.id, id);

		const [row] = await this.db.update(emito_alerts).set(setValues).where(where).returning();
		if (!row) {
			await this.throwForFailedUpdate(id, opts?.expectedVersion);
		}
		return this.mapRow(row);
	}

	async delete(id: string): Promise<void> {
		const [row] = await this.db
			.delete(emito_alerts)
			.where(eq(emito_alerts.id, id))
			.returning({ id: emito_alerts.id });
		if (!row) throw this.notFound(id);
	}

	async markTriggered(id: string, at: Date): Promise<void> {
		const [row] = await this.db
			.update(emito_alerts)
			.set({ lastTriggeredAt: at })
			.where(eq(emito_alerts.id, id))
			.returning({ id: emito_alerts.id });
		if (!row) throw this.notFound(id);
	}

	private async throwForFailedUpdate(id: string, expectedVersion?: number): Promise<never> {
		const current = await this.findById(id);
		if (!current) throw this.notFound(id);
		throw new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
			message: `Alert "${id}" version mismatch: expected ${expectedVersion}, found ${current.version}`,
			isRetryable: false,
			context: { id, expectedVersion, actualVersion: current.version },
		});
	}

	private notFound(id: string): EmitoError {
		return new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
			message: `Alert "${id}" not found`,
			isRetryable: false,
			context: { id },
		});
	}

	private async count(filters?: AlertFilters): Promise<number> {
		const where = this.buildWhere(filters, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_alerts)
			.where(where);
		return row?.value ?? 0;
	}

	private buildWhere(filters: AlertFilters | undefined, cursorDate: Date | undefined) {
		const conditions = [];
		if (filters?.enabled !== undefined) {
			conditions.push(eq(emito_alerts.enabled, filters.enabled));
		}
		if (filters?.severity !== undefined && filters.severity.length > 0) {
			conditions.push(inArray(emito_alerts.severity, filters.severity));
		}
		if (filters?.metric !== undefined && filters.metric.length > 0) {
			conditions.push(inArray(emito_alerts.metric, filters.metric));
		}
		if (cursorDate !== undefined) {
			conditions.push(lt(emito_alerts.createdAt, cursorDate));
		}
		return conditions.length > 0 ? and(...conditions) : undefined;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): AlertRecord {
		return {
			id: row.id,
			name: row.name,
			metric: row.metric,
			condition: (row.condition as Record<string, unknown>) ?? {},
			severity: row.severity as AlertSeverity,
			notify: (row.notify as Record<string, unknown>) ?? {},
			escalation: (row.escalation as Record<string, unknown> | null) ?? null,
			maintenance: (row.maintenance as Record<string, unknown> | null) ?? null,
			enabled: row.enabled,
			lastTriggeredAt: row.lastTriggeredAt ?? null,
			version: row.version,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}
