import type {
	CreateInboxData,
	CursorResult,
	InboxFilter,
	InboxRecord,
	InboxRepository,
} from "@emito/core";
import { and, count, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { emito_inbox } from "../schema/inbox";
import type { DrizzleDb } from "./db-type";
import { decodeCursorDate, normalizeLimit, toCursorResult } from "./pagination";

export class DrizzleInboxRepository implements InboxRepository {
	constructor(private readonly db: DrizzleDb) {}

	async create(data: CreateInboxData): Promise<InboxRecord> {
		const [row] = await this.db
			.insert(emito_inbox)
			.values({
				subscriberId: data.subscriberId,
				workspaceId: data.workspaceId,
				eventType: data.eventType,
				category: data.category,
				topicKey: data.topicKey,
				subject: data.subject,
				body: data.body,
				avatar: data.avatar,
				actionUrl: data.actionUrl,
				primaryActionLabel: data.primaryActionLabel,
				primaryActionUrl: data.primaryActionUrl,
				secondaryActionLabel: data.secondaryActionLabel,
				secondaryActionUrl: data.secondaryActionUrl,
				data: data.data ?? {},
			})
			.returning();
		return this.mapRow(row);
	}

	async findById(id: string): Promise<InboxRecord | undefined> {
		const [row] = await this.db.select().from(emito_inbox).where(eq(emito_inbox.id, id));
		return row ? this.mapRow(row) : undefined;
	}

	async findBySubscriber(
		subscriberId: string,
		filter?: InboxFilter,
	): Promise<CursorResult<InboxRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [eq(emito_inbox.subscriberId, subscriberId)];

		if (filter?.status === "unread") {
			conditions.push(isNull(emito_inbox.readAt));
			conditions.push(isNull(emito_inbox.archivedAt));
		} else if (filter?.status === "read") {
			conditions.push(isNotNull(emito_inbox.readAt));
			conditions.push(isNull(emito_inbox.archivedAt));
		} else if (filter?.status === "archived") {
			conditions.push(isNotNull(emito_inbox.archivedAt));
		}
		conditions.push(
			sql`(${emito_inbox.snoozedUntil} IS NULL OR ${emito_inbox.snoozedUntil} <= NOW())`,
		);
		if (filter?.category) conditions.push(eq(emito_inbox.category, filter.category));
		if (cursorDate) conditions.push(lt(emito_inbox.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_inbox)
			.where(and(...conditions))
			.orderBy(desc(emito_inbox.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	async updateReadAt(id: string): Promise<void> {
		await this.db.update(emito_inbox).set({ readAt: new Date() }).where(eq(emito_inbox.id, id));
	}

	async updateArchivedAt(id: string): Promise<void> {
		await this.db.update(emito_inbox).set({ archivedAt: new Date() }).where(eq(emito_inbox.id, id));
	}

	async unreadCount(subscriberId: string): Promise<number> {
		const [result] = await this.db
			.select({ value: count() })
			.from(emito_inbox)
			.where(
				and(
					eq(emito_inbox.subscriberId, subscriberId),
					isNull(emito_inbox.readAt),
					isNull(emito_inbox.archivedAt),
					sql`(${emito_inbox.snoozedUntil} IS NULL OR ${emito_inbox.snoozedUntil} <= NOW())`,
				),
			);
		return result?.value ?? 0;
	}

	async updateSnoozedUntil(id: string, snoozedUntil: Date): Promise<void> {
		await this.db.update(emito_inbox).set({ snoozedUntil }).where(eq(emito_inbox.id, id));
	}

	async markAllRead(subscriberId: string): Promise<void> {
		await this.db
			.update(emito_inbox)
			.set({ readAt: new Date() })
			.where(and(eq(emito_inbox.subscriberId, subscriberId), isNull(emito_inbox.readAt)));
	}

	async clearReadAt(id: string): Promise<void> {
		await this.db.update(emito_inbox).set({ readAt: null }).where(eq(emito_inbox.id, id));
	}

	async clearArchivedAt(id: string): Promise<void> {
		await this.db.update(emito_inbox).set({ archivedAt: null }).where(eq(emito_inbox.id, id));
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): InboxRecord {
		return {
			id: row.id,
			subscriberId: row.subscriberId,
			workspaceId: row.workspaceId ?? undefined,
			eventType: row.eventType,
			category: row.category,
			topicKey: row.topicKey ?? undefined,
			subject: row.subject ?? undefined,
			body: row.body,
			avatar: row.avatar ?? undefined,
			actionUrl: row.actionUrl ?? undefined,
			primaryActionLabel: row.primaryActionLabel ?? undefined,
			primaryActionUrl: row.primaryActionUrl ?? undefined,
			secondaryActionLabel: row.secondaryActionLabel ?? undefined,
			secondaryActionUrl: row.secondaryActionUrl ?? undefined,
			data: (row.data as Record<string, unknown>) ?? {},
			readAt: row.readAt ?? undefined,
			archivedAt: row.archivedAt ?? undefined,
			snoozedUntil: row.snoozedUntil ?? undefined,
			createdAt: row.createdAt,
		};
	}
}
