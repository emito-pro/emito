import type {
	AdminBroadcastCreate,
	AdminBroadcastFilters,
	AdminBroadcastRecord,
	AdminBroadcastStatus,
	ApiPage,
	BroadcastCounters,
	BroadcastRepository,
} from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { type SQL, and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { emito_broadcasts } from "../schema/broadcasts";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";

/** Counter columns, mapped to their Drizzle column for the atomic `GREATEST(0, …)` updates. */
const COUNTER_COLUMNS = {
	totalRecipients: emito_broadcasts.totalRecipients,
	sentCount: emito_broadcasts.sentCount,
	deliveredCount: emito_broadcasts.deliveredCount,
	failedCount: emito_broadcasts.failedCount,
	bouncedCount: emito_broadcasts.bouncedCount,
	openedCount: emito_broadcasts.openedCount,
	clickedCount: emito_broadcasts.clickedCount,
	unsubscribedCount: emito_broadcasts.unsubscribedCount,
} as const satisfies Record<
	keyof BroadcastCounters,
	(typeof emito_broadcasts)[keyof BroadcastCounters & keyof typeof emito_broadcasts]
>;

/**
 * Drizzle implementation of {@link BroadcastRepository} (executed-broadcast send-records).
 *
 * `incrementCounters` applies each supplied delta as `GREATEST(0, column + delta)` in a single
 * UPDATE so concurrent delivery callbacks never lose increments or underflow below zero.
 * `cancel` guards the lifecycle in the WHERE clause and disambiguates a zero-row update into
 * `RESOURCE_NOT_FOUND` vs `RESOURCE_CONFLICT`.
 */
export class DrizzleBroadcastRepository implements BroadcastRepository {
	constructor(private readonly db: DrizzleDb) {}

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AdminBroadcastFilters;
	}): Promise<ApiPage<AdminBroadcastRecord>> {
		const limit = normalizeAdminLimit(opts.limit);
		const cursorDate = decodeAdminCursorDate(opts.cursor);
		const where = this.buildWhere(opts.filters, cursorDate);

		const rows = await this.db
			.select()
			.from(emito_broadcasts)
			.where(where)
			.orderBy(desc(emito_broadcasts.createdAt))
			.limit(limit + 1);

		const total = await this.count(opts.filters);
		return buildAdminPage(
			rows.map((r) => this.mapRow(r)),
			limit,
			total,
			(r) => r.createdAt,
		);
	}

	async findById(id: string): Promise<AdminBroadcastRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_broadcasts)
			.where(eq(emito_broadcasts.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async create(input: AdminBroadcastCreate): Promise<AdminBroadcastRecord> {
		const [row] = await this.db
			.insert(emito_broadcasts)
			.values({
				title: input.title,
				listId: input.listId,
				eventKey: input.eventKey,
				payload: input.payload ?? {},
				status: input.status ?? "scheduled",
				scheduledFor: input.scheduledFor ?? null,
				startedAt: input.startedAt ?? null,
				totalRecipients: input.totalRecipients ?? 0,
				createdByUserId: input.createdByUserId,
			})
			.returning();
		return this.mapRow(row);
	}

	async cancel(id: string, _userId: string): Promise<AdminBroadcastRecord> {
		const [row] = await this.db
			.update(emito_broadcasts)
			.set({ status: "cancelled" })
			.where(
				and(
					eq(emito_broadcasts.id, id),
					inArray(emito_broadcasts.status, ["scheduled", "running"]),
				),
			)
			.returning();
		if (row) return this.mapRow(row);

		const current = await this.findById(id);
		if (!current) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
				message: `Broadcast "${id}" not found`,
				isRetryable: false,
				context: { id },
			});
		}
		throw new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
			message: `Cannot cancel broadcast "${id}" in status "${current.status}"`,
			isRetryable: false,
			context: { id, status: current.status },
		});
	}

	async incrementCounters(id: string, deltas: Partial<BroadcastCounters>): Promise<void> {
		const setValues: Record<string, SQL> = {};
		for (const key of Object.keys(COUNTER_COLUMNS) as (keyof BroadcastCounters)[]) {
			const delta = deltas[key];
			if (delta !== undefined) {
				const column = COUNTER_COLUMNS[key];
				setValues[key] = sql`GREATEST(0, ${column} + ${delta})`;
			}
		}
		if (Object.keys(setValues).length === 0) {
			// No-op delta map: still verify the broadcast exists for a consistent contract.
			const exists = await this.findById(id);
			if (!exists) throw this.notFound(id);
			return;
		}

		const [row] = await this.db
			.update(emito_broadcasts)
			.set(setValues)
			.where(eq(emito_broadcasts.id, id))
			.returning({ id: emito_broadcasts.id });
		if (!row) throw this.notFound(id);
	}

	private notFound(id: string): EmitoError {
		return new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
			message: `Broadcast "${id}" not found`,
			isRetryable: false,
			context: { id },
		});
	}

	private async count(filters?: AdminBroadcastFilters): Promise<number> {
		const where = this.buildWhere(filters, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_broadcasts)
			.where(where);
		return row?.value ?? 0;
	}

	private buildWhere(filters: AdminBroadcastFilters | undefined, cursorDate: Date | undefined) {
		const conditions = [];
		if (filters?.listId !== undefined) {
			conditions.push(eq(emito_broadcasts.listId, filters.listId));
		}
		if (filters?.status !== undefined && filters.status.length > 0) {
			conditions.push(inArray(emito_broadcasts.status, filters.status));
		}
		if (filters?.from !== undefined) {
			conditions.push(gte(emito_broadcasts.createdAt, filters.from));
		}
		if (filters?.to !== undefined) {
			conditions.push(lte(emito_broadcasts.createdAt, filters.to));
		}
		if (filters?.search !== undefined && filters.search.length > 0) {
			// Escape LIKE wildcards so a literal `%`/`_` in the query matches literally.
			const term = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
			const match = or(ilike(emito_broadcasts.title, term), ilike(emito_broadcasts.eventKey, term));
			if (match !== undefined) conditions.push(match);
		}
		if (cursorDate !== undefined) {
			conditions.push(lt(emito_broadcasts.createdAt, cursorDate));
		}
		return conditions.length > 0 ? and(...conditions) : undefined;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): AdminBroadcastRecord {
		return {
			id: row.id,
			title: row.title,
			listId: row.listId,
			eventKey: row.eventKey,
			payload: (row.payload as Record<string, unknown>) ?? {},
			status: row.status as AdminBroadcastStatus,
			scheduledFor: row.scheduledFor ?? null,
			startedAt: row.startedAt ?? null,
			completedAt: row.completedAt ?? null,
			totalRecipients: row.totalRecipients ?? 0,
			sentCount: row.sentCount ?? 0,
			deliveredCount: row.deliveredCount ?? 0,
			failedCount: row.failedCount ?? 0,
			bouncedCount: row.bouncedCount ?? 0,
			openedCount: row.openedCount ?? 0,
			clickedCount: row.clickedCount ?? 0,
			unsubscribedCount: row.unsubscribedCount ?? 0,
			createdByUserId: row.createdByUserId,
			createdAt: row.createdAt,
		};
	}
}
