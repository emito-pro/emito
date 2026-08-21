import type {
	ConsentFilter,
	ConsentRecord,
	ConsentRepository,
	CreateConsentData,
	CursorResult,
} from "@emito/core";
import { and, desc, eq, lt } from "drizzle-orm";
import { emito_consents } from "../schema/consents";
import type { DrizzleDb } from "./db-type";
import { decodeCursorDate, normalizeLimit, toCursorResult } from "./pagination";

export class DrizzleConsentRepository implements ConsentRepository {
	constructor(private readonly db: DrizzleDb) {}

	async recordConsent(data: CreateConsentData): Promise<ConsentRecord> {
		const [row] = await this.db
			.insert(emito_consents)
			.values({
				subscriberId: data.subscriberId,
				category: data.category,
				topicSlug: data.topicSlug,
				consented: data.consented,
				ipAddress: data.ipAddress,
				userAgent: data.userAgent,
				source: data.source,
			})
			.returning();
		return this.mapRow(row);
	}

	async getLatestConsent(subscriberId: string, category: string): Promise<ConsentRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_consents)
			.where(
				and(eq(emito_consents.subscriberId, subscriberId), eq(emito_consents.category, category)),
			)
			.orderBy(desc(emito_consents.createdAt))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async listConsentHistory(
		subscriberId: string,
		filter?: ConsentFilter,
	): Promise<CursorResult<ConsentRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [eq(emito_consents.subscriberId, subscriberId)];
		if (filter?.category) conditions.push(eq(emito_consents.category, filter.category));
		if (cursorDate) conditions.push(lt(emito_consents.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_consents)
			.where(and(...conditions))
			.orderBy(desc(emito_consents.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	async listAll(filter?: ConsentFilter): Promise<CursorResult<ConsentRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [];
		if (filter?.subscriberId) conditions.push(eq(emito_consents.subscriberId, filter.subscriberId));
		if (filter?.category) conditions.push(eq(emito_consents.category, filter.category));
		if (cursorDate) conditions.push(lt(emito_consents.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_consents)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(desc(emito_consents.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): ConsentRecord {
		return {
			id: row.id,
			subscriberId: row.subscriberId,
			category: row.category,
			topicSlug: row.topicSlug ?? undefined,
			consented: row.consented,
			ipAddress: row.ipAddress ?? undefined,
			userAgent: row.userAgent ?? undefined,
			source: row.source ?? undefined,
			createdAt: row.createdAt,
		};
	}
}
