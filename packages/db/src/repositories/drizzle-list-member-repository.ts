import type {
	CreateListMemberData,
	CursorResult,
	ListMemberFilter,
	ListMemberRecord,
	ListMemberRepository,
	ListMemberStatus,
} from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { and, count, desc, eq, lt } from "drizzle-orm";
import { emito_list_members } from "../schema/list-members";
import type { DrizzleDb } from "./db-type";
import { decodeCursorDate, normalizeLimit, toCursorResult } from "./pagination";

export class DrizzleListMemberRepository implements ListMemberRepository {
	constructor(private readonly db: DrizzleDb) {}

	async subscribe(
		data: CreateListMemberData,
	): Promise<{ member: ListMemberRecord; created: boolean }> {
		const rows = await this.db
			.insert(emito_list_members)
			.values({
				subscriberId: data.subscriberId,
				listId: data.listId,
				status: "unconfirmed",
				source: data.source,
				subscribedAt: new Date(),
			})
			.onConflictDoNothing({
				target: [emito_list_members.subscriberId, emito_list_members.listId],
			})
			.returning();

		if (rows.length > 0) {
			return { member: this.mapRow(rows[0]), created: true };
		}

		const existing = await this.findBySubscriberAndList(data.subscriberId, data.listId);
		if (!existing) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.INTERNAL_ERROR,
				message: "Subscribe conflict but existing record not found",
				isRetryable: true,
			});
		}
		return { member: existing, created: false };
	}

	async confirm(subscriberId: string, listId: string): Promise<ListMemberRecord> {
		const [row] = await this.db
			.update(emito_list_members)
			.set({ status: "confirmed", confirmedAt: new Date() })
			.where(
				and(
					eq(emito_list_members.subscriberId, subscriberId),
					eq(emito_list_members.listId, listId),
				),
			)
			.returning();

		if (!row) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: "List membership not found",
				isRetryable: false,
			});
		}
		return this.mapRow(row);
	}

	async unsubscribe(subscriberId: string, listId: string): Promise<ListMemberRecord> {
		const [row] = await this.db
			.update(emito_list_members)
			.set({ status: "unsubscribed", unsubscribedAt: new Date() })
			.where(
				and(
					eq(emito_list_members.subscriberId, subscriberId),
					eq(emito_list_members.listId, listId),
				),
			)
			.returning();

		if (!row) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: "List membership not found",
				isRetryable: false,
			});
		}
		return this.mapRow(row);
	}

	async findBySubscriberAndList(
		subscriberId: string,
		listId: string,
	): Promise<ListMemberRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_list_members)
			.where(
				and(
					eq(emito_list_members.subscriberId, subscriberId),
					eq(emito_list_members.listId, listId),
				),
			)
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async listByList(
		listId: string,
		filter?: ListMemberFilter,
	): Promise<CursorResult<ListMemberRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [eq(emito_list_members.listId, listId)];
		if (filter?.status) conditions.push(eq(emito_list_members.status, filter.status));
		if (cursorDate) conditions.push(lt(emito_list_members.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_list_members)
			.where(and(...conditions))
			.orderBy(desc(emito_list_members.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	async listBySubscriber(
		subscriberId: string,
		filter?: ListMemberFilter,
	): Promise<CursorResult<ListMemberRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [eq(emito_list_members.subscriberId, subscriberId)];
		if (filter?.status) conditions.push(eq(emito_list_members.status, filter.status));
		if (cursorDate) conditions.push(lt(emito_list_members.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_list_members)
			.where(and(...conditions))
			.orderBy(desc(emito_list_members.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	async countConfirmed(listId: string): Promise<number> {
		const [result] = await this.db
			.select({ value: count() })
			.from(emito_list_members)
			.where(
				and(eq(emito_list_members.listId, listId), eq(emito_list_members.status, "confirmed")),
			);
		return result?.value ?? 0;
	}

	/**
	 * Count a list's members in one `COUNT(*)`, optionally narrowed by status.
	 *
	 * Backs the members-grid footer total without the O(n/page) page-walk the
	 * the admin surface previously used: a single aggregate over the `(listId[, status])`
	 * predicate, served by the list-member indexes.
	 */
	async countByList(listId: string, status?: ListMemberStatus): Promise<number> {
		const conditions = [eq(emito_list_members.listId, listId)];
		if (status !== undefined) conditions.push(eq(emito_list_members.status, status));
		const [result] = await this.db
			.select({ value: count() })
			.from(emito_list_members)
			.where(and(...conditions));
		return result?.value ?? 0;
	}

	async deleteExpiredUnconfirmed(olderThan: Date): Promise<number> {
		const rows = await this.db
			.delete(emito_list_members)
			.where(
				and(
					eq(emito_list_members.status, "unconfirmed"),
					lt(emito_list_members.createdAt, olderThan),
				),
			)
			.returning({ id: emito_list_members.id });
		return rows.length;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): ListMemberRecord {
		return {
			id: row.id,
			subscriberId: row.subscriberId,
			listId: row.listId,
			status: row.status,
			source: row.source ?? undefined,
			subscribedAt: row.subscribedAt ?? undefined,
			confirmedAt: row.confirmedAt ?? undefined,
			unsubscribedAt: row.unsubscribedAt ?? undefined,
			createdAt: row.createdAt,
		};
	}
}
