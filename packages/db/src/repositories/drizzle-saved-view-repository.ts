import type {
	ApiPage,
	SavedViewCreate,
	SavedViewPatch,
	SavedViewRecord,
	SavedViewRepository,
	SavedViewScope,
} from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { emito_saved_views } from "../schema/saved-views";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";

/**
 * Drizzle implementation of {@link SavedViewRepository}.
 *
 * `list` is always user-scoped. `create` relies on the `(createdByUserId, name, page)` unique
 * index — a duplicate insert is caught and re-mapped to `RESOURCE_CONFLICT` rather than leaking
 * the raw Postgres constraint error.
 */
export class DrizzleSavedViewRepository implements SavedViewRepository {
	constructor(private readonly db: DrizzleDb) {}

	async list(opts: {
		userId: string;
		page?: string;
		cursor?: string | null;
		limit: number;
	}): Promise<ApiPage<SavedViewRecord>> {
		const limit = normalizeAdminLimit(opts.limit);
		const cursorDate = decodeAdminCursorDate(opts.cursor);
		const where = this.buildWhere(opts.userId, opts.page, cursorDate);

		const rows = await this.db
			.select()
			.from(emito_saved_views)
			.where(where)
			.orderBy(desc(emito_saved_views.createdAt))
			.limit(limit + 1);

		const total = await this.count(opts.userId, opts.page);
		return buildAdminPage(
			rows.map((r) => this.mapRow(r)),
			limit,
			total,
			(r) => r.createdAt,
		);
	}

	async findById(id: string): Promise<SavedViewRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_saved_views)
			.where(eq(emito_saved_views.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async create(input: SavedViewCreate): Promise<SavedViewRecord> {
		try {
			const [row] = await this.db
				.insert(emito_saved_views)
				.values({
					name: input.name,
					page: input.page,
					filters: input.filters ?? {},
					scope: input.scope ?? "private",
					createdByUserId: input.createdByUserId,
				})
				.returning();
			return this.mapRow(row);
		} catch (err) {
			if (isUniqueViolation(err)) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
					message: `Saved view "${input.name}" already exists on page "${input.page}" for this user`,
					isRetryable: false,
					context: { name: input.name, page: input.page, userId: input.createdByUserId },
					cause: err instanceof Error ? err : undefined,
				});
			}
			throw err;
		}
	}

	async update(id: string, patch: SavedViewPatch): Promise<SavedViewRecord> {
		const setValues: Record<string, unknown> = { updatedAt: new Date() };
		if (patch.name !== undefined) setValues.name = patch.name;
		if (patch.filters !== undefined) setValues.filters = patch.filters;
		if (patch.scope !== undefined) setValues.scope = patch.scope;

		const [row] = await this.db
			.update(emito_saved_views)
			.set(setValues)
			.where(eq(emito_saved_views.id, id))
			.returning();
		if (!row) throw this.notFound(id);
		return this.mapRow(row);
	}

	async delete(id: string): Promise<void> {
		const [row] = await this.db
			.delete(emito_saved_views)
			.where(eq(emito_saved_views.id, id))
			.returning({ id: emito_saved_views.id });
		if (!row) throw this.notFound(id);
	}

	private notFound(id: string): EmitoError {
		return new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
			message: `Saved view "${id}" not found`,
			isRetryable: false,
			context: { id },
		});
	}

	private async count(userId: string, page?: string): Promise<number> {
		const where = this.buildWhere(userId, page, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_saved_views)
			.where(where);
		return row?.value ?? 0;
	}

	private buildWhere(userId: string, page: string | undefined, cursorDate: Date | undefined) {
		const conditions = [eq(emito_saved_views.createdByUserId, userId)];
		if (page !== undefined) {
			conditions.push(eq(emito_saved_views.page, page));
		}
		if (cursorDate !== undefined) {
			conditions.push(lt(emito_saved_views.createdAt, cursorDate));
		}
		return and(...conditions);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): SavedViewRecord {
		return {
			id: row.id,
			name: row.name,
			page: row.page,
			filters: (row.filters as Record<string, unknown>) ?? {},
			scope: row.scope as SavedViewScope,
			createdByUserId: row.createdByUserId,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}

/** Narrow an unknown thrown value to a Postgres unique-violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
	return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}
