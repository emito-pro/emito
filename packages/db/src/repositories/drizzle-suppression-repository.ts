import type {
	ApiPage,
	CreateSuppressionData,
	CursorResult,
	SuppressionAdminFilter,
	SuppressionFilter,
	SuppressionRecord,
	SuppressionRepository,
} from "@emito/core";
import type { Channel } from "@emito/types";
import { type SQL, and, desc, eq, gte, ilike, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { emito_suppression } from "../schema/suppression";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";
import { decodeCursorDate, normalizeLimit, toCursorResult } from "./pagination";

/** Escape LIKE/ILIKE metacharacters so a user search term matches literally. */
function escapeLike(term: string): string {
	return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export class DrizzleSuppressionRepository implements SuppressionRepository {
	constructor(private readonly db: DrizzleDb) {}

	async findById(id: string): Promise<SuppressionRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_suppression)
			.where(eq(emito_suppression.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async findByAddressAndChannel(
		address: string,
		channel: Channel,
	): Promise<SuppressionRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_suppression)
			.where(
				and(
					eq(emito_suppression.address, address),
					eq(emito_suppression.channel, channel),
					isNull(emito_suppression.archivedAt),
				),
			)
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async create(data: CreateSuppressionData): Promise<SuppressionRecord> {
		const [row] = await this.db
			.insert(emito_suppression)
			.values({
				address: data.address,
				channel: data.channel,
				reason: data.reason,
				provider: data.provider,
				providerMsgId: data.providerMsgId,
			})
			.returning();
		return this.mapRow(row);
	}

	async archive(address: string, channel: Channel): Promise<boolean> {
		const result = await this.db
			.update(emito_suppression)
			.set({ archivedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(emito_suppression.address, address),
					eq(emito_suppression.channel, channel),
					isNull(emito_suppression.archivedAt),
				),
			)
			.returning({ id: emito_suppression.id });
		return result.length > 0;
	}

	async list(filter?: SuppressionFilter): Promise<CursorResult<SuppressionRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [];
		if (!filter?.includeArchived) conditions.push(isNull(emito_suppression.archivedAt));
		if (filter?.channel) conditions.push(eq(emito_suppression.channel, filter.channel));
		if (cursorDate) conditions.push(lt(emito_suppression.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_suppression)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(desc(emito_suppression.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	async listForAdmin(filter?: SuppressionAdminFilter): Promise<ApiPage<SuppressionRecord>> {
		const limit = normalizeAdminLimit(filter?.limit);
		const cursorDate = decodeAdminCursorDate(filter?.cursor);
		const where = this.buildAdminWhere(filter, cursorDate);

		const rows = await this.db
			.select()
			.from(emito_suppression)
			.where(where)
			.orderBy(desc(emito_suppression.createdAt))
			.limit(limit + 1);

		const total = await this.countForAdmin(filter);
		return buildAdminPage(
			rows.map((r) => this.mapRow(r)),
			limit,
			total,
			(r) => r.createdAt,
		);
	}

	private async countForAdmin(filter?: SuppressionAdminFilter): Promise<number> {
		const where = this.buildAdminWhere(filter, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_suppression)
			.where(where);
		return row?.value ?? 0;
	}

	/**
	 * Assemble the WHERE clause shared by the admin list + its COUNT(*).
	 *
	 * `cursorDate` is folded in for the keyset page (`lt(createdAt, cursorDate)`)
	 * but omitted for the count so `total` reflects the filter set, not the page
	 * window. Active-only unless `includeArchived`; multi-value facets use
	 * `inArray`, the address search a metachar-escaped `ilike`.
	 */
	private buildAdminWhere(
		filter: SuppressionAdminFilter | undefined,
		cursorDate: Date | undefined,
	): SQL | undefined {
		const conditions: SQL[] = [];
		if (!filter?.includeArchived) conditions.push(isNull(emito_suppression.archivedAt));
		if (filter?.channels && filter.channels.length > 0) {
			conditions.push(inArray(emito_suppression.channel, filter.channels));
		}
		if (filter?.reasons && filter.reasons.length > 0) {
			conditions.push(inArray(emito_suppression.reason, filter.reasons));
		}
		if (filter?.providers && filter.providers.length > 0) {
			conditions.push(inArray(emito_suppression.provider, filter.providers));
		}
		if (filter?.addressSearch && filter.addressSearch.trim().length > 0) {
			conditions.push(
				ilike(emito_suppression.address, `%${escapeLike(filter.addressSearch.trim())}%`),
			);
		}
		if (filter?.addedFrom) conditions.push(gte(emito_suppression.createdAt, filter.addedFrom));
		if (filter?.addedTo) conditions.push(lte(emito_suppression.createdAt, filter.addedTo));
		if (cursorDate) conditions.push(lt(emito_suppression.createdAt, cursorDate));
		return conditions.length > 0 ? and(...conditions) : undefined;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): SuppressionRecord {
		return {
			id: row.id,
			address: row.address,
			channel: row.channel,
			reason: row.reason,
			provider: row.provider ?? undefined,
			providerMsgId: row.providerMsgId ?? undefined,
			consecutiveSoft: row.consecutiveSoft ?? 0,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			archivedAt: row.archivedAt ?? undefined,
		};
	}
}
