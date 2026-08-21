import type {
	ApiPage,
	ScheduledSendCreate,
	ScheduledSendFilters,
	ScheduledSendKind,
	ScheduledSendRecord,
	ScheduledSendRepository,
	ScheduledSendStatus,
} from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { emito_scheduled_sends } from "../schema/scheduled-sends";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";

/**
 * Drizzle implementation of {@link ScheduledSendRepository}.
 *
 * `cancel` and `reschedule` guard the lifecycle inside the WHERE clause (cancel excludes
 * terminal rows; reschedule requires `pending`). A zero-row update is disambiguated via a
 * follow-up `findById` into `RESOURCE_NOT_FOUND` vs `RESOURCE_CONFLICT`. `dueBy` reads the
 * partial `WHERE status='pending'` index for cheap scheduler polling.
 */
export class DrizzleScheduledSendRepository implements ScheduledSendRepository {
	constructor(private readonly db: DrizzleDb) {}

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: ScheduledSendFilters;
	}): Promise<ApiPage<ScheduledSendRecord>> {
		const limit = normalizeAdminLimit(opts.limit);
		const cursorDate = decodeAdminCursorDate(opts.cursor);
		const where = this.buildWhere(opts.filters, cursorDate);

		const rows = await this.db
			.select()
			.from(emito_scheduled_sends)
			.where(where)
			.orderBy(desc(emito_scheduled_sends.createdAt))
			.limit(limit + 1);

		const total = await this.count(opts.filters);
		return buildAdminPage(
			rows.map((r) => this.mapRow(r)),
			limit,
			total,
			(r) => r.createdAt,
		);
	}

	async findById(id: string): Promise<ScheduledSendRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_scheduled_sends)
			.where(eq(emito_scheduled_sends.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async create(input: ScheduledSendCreate): Promise<ScheduledSendRecord> {
		const [row] = await this.db
			.insert(emito_scheduled_sends)
			.values({
				kind: input.kind,
				eventKey: input.eventKey,
				payload: input.payload ?? {},
				recipients: input.recipients ?? {},
				scheduledFor: input.scheduledFor,
				timezone: input.timezone,
				status: "pending",
				createdByUserId: input.createdByUserId,
			})
			.returning();
		return this.mapRow(row);
	}

	async cancel(id: string, userId: string): Promise<ScheduledSendRecord> {
		const now = new Date();
		const [row] = await this.db
			.update(emito_scheduled_sends)
			.set({
				status: "cancelled",
				cancelledAt: now,
				cancelledByUserId: userId,
				updatedAt: now,
			})
			.where(
				and(
					eq(emito_scheduled_sends.id, id),
					inArray(emito_scheduled_sends.status, ["pending", "running"]),
				),
			)
			.returning();
		if (row) return this.mapRow(row);
		return this.throwLifecycle(id, "cancel");
	}

	async reschedule(id: string, when: Date, timezone: string): Promise<ScheduledSendRecord> {
		const [row] = await this.db
			.update(emito_scheduled_sends)
			.set({ scheduledFor: when, timezone, updatedAt: new Date() })
			.where(and(eq(emito_scheduled_sends.id, id), eq(emito_scheduled_sends.status, "pending")))
			.returning();
		if (row) return this.mapRow(row);
		return this.throwLifecycle(id, "reschedule");
	}

	async dueBy(at: Date, limit: number): Promise<readonly ScheduledSendRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_scheduled_sends)
			.where(
				and(
					eq(emito_scheduled_sends.status, "pending"),
					lte(emito_scheduled_sends.scheduledFor, at),
				),
			)
			.orderBy(asc(emito_scheduled_sends.scheduledFor))
			.limit(Math.max(0, normalizeAdminLimit(limit)));
		return rows.map((r) => this.mapRow(r));
	}

	private async throwLifecycle(id: string, op: string): Promise<never> {
		const current = await this.findById(id);
		if (!current) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
				message: `Scheduled send "${id}" not found`,
				isRetryable: false,
				context: { id },
			});
		}
		throw new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
			message: `Cannot ${op} scheduled send "${id}" in status "${current.status}"`,
			isRetryable: false,
			context: { id, status: current.status, op },
		});
	}

	private async count(filters?: ScheduledSendFilters): Promise<number> {
		const where = this.buildWhere(filters, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_scheduled_sends)
			.where(where);
		return row?.value ?? 0;
	}

	private buildWhere(filters: ScheduledSendFilters | undefined, cursorDate: Date | undefined) {
		const conditions = [];
		if (filters?.status !== undefined && filters.status.length > 0) {
			conditions.push(inArray(emito_scheduled_sends.status, filters.status));
		}
		if (filters?.from !== undefined) {
			conditions.push(gte(emito_scheduled_sends.scheduledFor, filters.from));
		}
		if (filters?.to !== undefined) {
			conditions.push(lte(emito_scheduled_sends.scheduledFor, filters.to));
		}
		if (cursorDate !== undefined) {
			conditions.push(lt(emito_scheduled_sends.createdAt, cursorDate));
		}
		return conditions.length > 0 ? and(...conditions) : undefined;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): ScheduledSendRecord {
		return {
			id: row.id,
			kind: row.kind as ScheduledSendKind,
			eventKey: row.eventKey,
			payload: (row.payload as Record<string, unknown>) ?? {},
			recipients: (row.recipients as Record<string, unknown>) ?? {},
			scheduledFor: row.scheduledFor,
			timezone: row.timezone,
			status: row.status as ScheduledSendStatus,
			createdByUserId: row.createdByUserId,
			cancelledAt: row.cancelledAt ?? null,
			cancelledByUserId: row.cancelledByUserId ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}
