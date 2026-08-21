import type {
	CreateListData,
	CursorResult,
	ListFilter,
	ListRecord,
	ListRepository,
	UpdateListData,
} from "@emito/core";
import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { emito_lists } from "../schema/lists";
import type { DrizzleDb } from "./db-type";
import { decodeCursorDate, normalizeLimit, toCursorResult } from "./pagination";

export class DrizzleListRepository implements ListRepository {
	constructor(private readonly db: DrizzleDb) {}

	async create(data: CreateListData): Promise<ListRecord> {
		const [row] = await this.db
			.insert(emito_lists)
			.values({
				name: data.name,
				slug: data.slug,
				description: data.description,
				optinType: data.optinType ?? "single",
				visibility: data.visibility ?? "private",
				categoryId: data.categoryId,
			})
			.returning();
		return this.mapRow(row);
	}

	async findById(id: string): Promise<ListRecord | null> {
		const [row] = await this.db.select().from(emito_lists).where(eq(emito_lists.id, id)).limit(1);
		return row ? this.mapRow(row) : null;
	}

	async findBySlug(slug: string): Promise<ListRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_lists)
			.where(and(eq(emito_lists.slug, slug), isNull(emito_lists.archivedAt)))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async list(filter?: ListFilter): Promise<CursorResult<ListRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [];
		if (filter?.archived === false) {
			conditions.push(isNull(emito_lists.archivedAt));
		} else if (filter?.archived === true) {
			conditions.push(isNotNull(emito_lists.archivedAt));
		}
		if (cursorDate) conditions.push(lt(emito_lists.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_lists)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(desc(emito_lists.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	async update(id: string, data: UpdateListData): Promise<ListRecord> {
		const values: Record<string, unknown> = { updatedAt: new Date() };
		if (data.name !== undefined) values.name = data.name;
		if (data.description !== undefined) values.description = data.description;

		const [row] = await this.db
			.update(emito_lists)
			.set(values)
			.where(eq(emito_lists.id, id))
			.returning();
		return this.mapRow(row);
	}

	async archive(id: string): Promise<ListRecord> {
		const now = new Date();
		const [row] = await this.db
			.update(emito_lists)
			.set({ archivedAt: now, updatedAt: now })
			.where(eq(emito_lists.id, id))
			.returning();
		return this.mapRow(row);
	}

	async updateMemberCount(id: string, delta: number): Promise<void> {
		await this.db
			.update(emito_lists)
			.set({
				memberCount: sql`GREATEST(0, ${emito_lists.memberCount} + ${delta})`,
			})
			.where(eq(emito_lists.id, id));
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): ListRecord {
		return {
			id: row.id,
			name: row.name,
			slug: row.slug,
			description: row.description ?? undefined,
			optinType: row.optinType,
			visibility: row.visibility,
			categoryId: row.categoryId ?? undefined,
			memberCount: row.memberCount ?? 0,
			archivedAt: row.archivedAt ?? undefined,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}
