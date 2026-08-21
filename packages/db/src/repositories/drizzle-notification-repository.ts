import type {
	ApiPage,
	CreateNotificationData,
	CursorResult,
	NotificationFilter,
	NotificationRecord,
	NotificationRepository,
	UpdateNotificationStatusData,
} from "@emito/core";
import type { Channel, DeliveryStatus, ErrorClassification } from "@emito/types";
import { type SQL, and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { emito_notifications } from "../schema/notifications";
import { emito_subscribers } from "../schema/subscribers";
import type { AdminNotificationListFilters, AdminNotificationRow } from "./admin-notification-list";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";
import { decodeCursorDate, normalizeLimit, toCursorResult } from "./pagination";

export class DrizzleNotificationRepository implements NotificationRepository {
	constructor(private readonly db: DrizzleDb) {}

	async create(data: CreateNotificationData): Promise<NotificationRecord> {
		const [row] = await this.db
			.insert(emito_notifications)
			.values({
				id: data.id,
				subscriberId: data.subscriberId,
				workspaceId: data.workspaceId,
				eventType: data.eventType,
				category: data.category,
				channel: data.channel,
				status: data.status ?? "pending",
				deliveryAddress: data.deliveryAddress,
				payload: data.payload ?? {},
				metadata: data.metadata ?? {},
				idempotencyKey: data.idempotencyKey,
			})
			.returning();
		return this.mapRow(row);
	}

	async updateStatus(
		id: string,
		status: DeliveryStatus,
		metadata?: UpdateNotificationStatusData,
	): Promise<void> {
		await this.db
			.update(emito_notifications)
			.set({ status, ...metadata })
			.where(eq(emito_notifications.id, id));
	}

	async findById(id: string): Promise<NotificationRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_notifications)
			.where(eq(emito_notifications.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async findByProviderMsgId(providerMsgId: string): Promise<NotificationRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_notifications)
			.where(eq(emito_notifications.providerMsgId, providerMsgId))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async list(
		subscriberId: string,
		filter?: NotificationFilter,
	): Promise<CursorResult<NotificationRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [eq(emito_notifications.subscriberId, subscriberId)];
		if (filter?.status) conditions.push(eq(emito_notifications.status, filter.status));
		if (filter?.category) conditions.push(eq(emito_notifications.category, filter.category));
		if (filter?.channel) conditions.push(eq(emito_notifications.channel, filter.channel));
		if (filter?.since) conditions.push(gte(emito_notifications.createdAt, filter.since));
		if (filter?.until) conditions.push(lte(emito_notifications.createdAt, filter.until));
		if (cursorDate) conditions.push(lt(emito_notifications.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_notifications)
			.where(and(...conditions))
			.orderBy(desc(emito_notifications.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	async listCrossWorkspace(filter?: NotificationFilter): Promise<CursorResult<NotificationRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [];
		if (filter?.status) conditions.push(eq(emito_notifications.status, filter.status));
		if (filter?.category) conditions.push(eq(emito_notifications.category, filter.category));
		if (filter?.channel) conditions.push(eq(emito_notifications.channel, filter.channel));
		if (filter?.since) conditions.push(gte(emito_notifications.createdAt, filter.since));
		if (filter?.until) conditions.push(lte(emito_notifications.createdAt, filter.until));
		if (cursorDate) conditions.push(lt(emito_notifications.createdAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_notifications)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(desc(emito_notifications.createdAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.createdAt.toISOString(),
		);
	}

	/**
	 * Page over the cross-workspace notification log for the Activity Log admin
	 * grid, newest-first by `createdAt`, applying the optional multi-value filters.
	 *
	 * Rows are left-joined to `emito_subscribers` so each row carries the recipient
	 * email/phone (and the metadata bag the endpoint resolves the workspace label
	 * from) without a per-row lookup; a notification whose subscriber is absent or
	 * erased still appears (those joined fields degrade to `null`/`{}`). The page is
	 * date-cursor paginated via the shared {@link buildAdminPage} helper and `total`
	 * is the full filtered, pre-slice count from a parallel `COUNT(*)` under the same
	 * WHERE clause — matching the {@link DrizzleBroadcastRepository.list} idiom.
	 *
	 * @param opts - Page size, opaque cursor, and the Activity Log filter set.
	 * @returns An {@link ApiPage} of enriched notification rows.
	 * @throws EmitoError CURSOR_INVALID when the cursor cannot be decoded to a date.
	 */
	async listAdmin(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AdminNotificationListFilters;
	}): Promise<ApiPage<AdminNotificationRow>> {
		const limit = normalizeAdminLimit(opts.limit);
		const cursorDate = decodeAdminCursorDate(opts.cursor);
		const where = this.buildAdminWhere(opts.filters, cursorDate);

		const rows = await this.db
			.select({
				id: emito_notifications.id,
				subscriberId: emito_notifications.subscriberId,
				subscriberEmail: emito_subscribers.email,
				subscriberPhone: emito_subscribers.phone,
				subscriberMetadata: emito_subscribers.metadata,
				eventType: emito_notifications.eventType,
				category: emito_notifications.category,
				channel: emito_notifications.channel,
				status: emito_notifications.status,
				provider: emito_notifications.provider,
				providerMsgId: emito_notifications.providerMsgId,
				workspaceId: emito_notifications.workspaceId,
				attempts: emito_notifications.attempts,
				createdAt: emito_notifications.createdAt,
				sentAt: emito_notifications.sentAt,
				deliveredAt: emito_notifications.deliveredAt,
				openedAt: emito_notifications.openedAt,
				clickedAt: emito_notifications.clickedAt,
				errorMessage: emito_notifications.errorMessage,
				errorClassification: emito_notifications.errorClassification,
			})
			.from(emito_notifications)
			.leftJoin(emito_subscribers, eq(emito_notifications.subscriberId, emito_subscribers.id))
			.where(where)
			.orderBy(desc(emito_notifications.createdAt))
			.limit(limit + 1);

		const total = await this.countAdmin(opts.filters);
		return buildAdminPage(
			rows.map((r) => this.mapAdminRow(r)),
			limit,
			total,
			(r) => r.createdAt,
		);
	}

	private async countAdmin(filters?: AdminNotificationListFilters): Promise<number> {
		const where = this.buildAdminWhere(filters, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_notifications)
			.leftJoin(emito_subscribers, eq(emito_notifications.subscriberId, emito_subscribers.id))
			.where(where);
		return row?.value ?? 0;
	}

	private buildAdminWhere(
		filters: AdminNotificationListFilters | undefined,
		cursorDate: Date | undefined,
	): SQL | undefined {
		const conditions: SQL[] = [];
		if (filters?.status !== undefined && filters.status.length > 0) {
			conditions.push(inArray(emito_notifications.status, [...filters.status]));
		}
		if (filters?.channel !== undefined && filters.channel.length > 0) {
			conditions.push(inArray(emito_notifications.channel, [...filters.channel]));
		}
		if (filters?.event !== undefined && filters.event.length > 0) {
			conditions.push(inArray(emito_notifications.eventType, [...filters.event]));
		}
		if (filters?.category !== undefined && filters.category.length > 0) {
			conditions.push(inArray(emito_notifications.category, [...filters.category]));
		}
		if (filters?.provider !== undefined && filters.provider.length > 0) {
			conditions.push(inArray(emito_notifications.provider, [...filters.provider]));
		}
		if (filters?.errorType !== undefined && filters.errorType.length > 0) {
			conditions.push(inArray(emito_notifications.errorClassification, [...filters.errorType]));
		}
		if (filters?.workspaceId !== undefined) {
			conditions.push(eq(emito_notifications.workspaceId, filters.workspaceId));
		}
		if (filters?.subscriberId !== undefined) {
			conditions.push(eq(emito_notifications.subscriberId, filters.subscriberId));
		}
		if (filters?.from !== undefined) {
			conditions.push(gte(emito_notifications.createdAt, filters.from));
		}
		if (filters?.to !== undefined) {
			conditions.push(lte(emito_notifications.createdAt, filters.to));
		}
		if (filters?.q !== undefined && filters.q.trim().length > 0) {
			const needle = `%${filters.q.trim()}%`;
			const search = or(
				ilike(emito_notifications.id, needle),
				ilike(emito_notifications.eventType, needle),
				ilike(emito_subscribers.email, needle),
				ilike(emito_subscribers.phone, needle),
			);
			if (search !== undefined) conditions.push(search);
		}
		if (cursorDate !== undefined) {
			conditions.push(lt(emito_notifications.createdAt, cursorDate));
		}
		return conditions.length > 0 ? and(...conditions) : undefined;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapAdminRow(row: any): AdminNotificationRow {
		return {
			id: row.id,
			subscriberId: row.subscriberId,
			subscriberEmail: (row.subscriberEmail as string | null) ?? null,
			subscriberPhone: (row.subscriberPhone as string | null) ?? null,
			subscriberMetadata: (row.subscriberMetadata as Record<string, unknown> | null) ?? {},
			eventType: row.eventType,
			category: row.category,
			channel: row.channel as Channel,
			status: row.status as DeliveryStatus,
			provider: (row.provider as string | null) ?? null,
			providerMsgId: (row.providerMsgId as string | null) ?? null,
			workspaceId: (row.workspaceId as string | null) ?? null,
			attempts: row.attempts ?? 0,
			createdAt: row.createdAt,
			sentAt: row.sentAt ?? null,
			deliveredAt: row.deliveredAt ?? null,
			openedAt: row.openedAt ?? null,
			clickedAt: row.clickedAt ?? null,
			errorMessage: (row.errorMessage as string | null) ?? null,
			errorClassification: (row.errorClassification as ErrorClassification | null) ?? null,
		};
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): NotificationRecord {
		return {
			id: row.id,
			subscriberId: row.subscriberId,
			workspaceId: row.workspaceId ?? undefined,
			eventType: row.eventType,
			category: row.category,
			channel: row.channel,
			status: row.status,
			deliveryAddress: row.deliveryAddress ?? undefined,
			provider: row.provider ?? undefined,
			providerMsgId: row.providerMsgId ?? undefined,
			errorMessage: row.errorMessage ?? undefined,
			errorClassification: row.errorClassification ?? undefined,
			attempts: row.attempts ?? 0,
			payload: (row.payload as Record<string, unknown>) ?? {},
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			idempotencyKey: row.idempotencyKey ?? undefined,
			createdAt: row.createdAt,
			sentAt: row.sentAt ?? undefined,
			deliveredAt: row.deliveredAt ?? undefined,
			openedAt: row.openedAt ?? undefined,
			clickedAt: row.clickedAt ?? undefined,
			failedAt: row.failedAt ?? undefined,
		};
	}
}
