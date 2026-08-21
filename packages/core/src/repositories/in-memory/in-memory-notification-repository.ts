import type { DeliveryStatus } from "@emito/types";
import type { NotificationRepository } from "../notification-repository";
import type {
	CreateNotificationData,
	CursorResult,
	NotificationFilter,
	NotificationRecord,
	UpdateNotificationStatusData,
} from "../types";
import { applyInMemoryCursor } from "./cursor-helpers";

export class InMemoryNotificationRepository implements NotificationRepository {
	private store = new Map<string, NotificationRecord>();
	private counter = 0;

	async create(data: CreateNotificationData): Promise<NotificationRecord> {
		// `id` is the sole primary key in the real (Postgres) schema — mirror that
		// constraint here. Silently overwriting on a duplicate id would hide the
		// exact bug this repository exists to catch in unit tests (a caller
		// reusing one id across multiple rows in the same send()).
		if (data.id !== undefined && this.store.has(data.id)) {
			throw new Error(
				`duplicate key value violates unique constraint "notifications_pkey": ${data.id}`,
			);
		}
		this.counter++;
		const record: NotificationRecord = {
			id: data.id ?? `notif_mem_${String(this.counter).padStart(6, "0")}`,
			subscriberId: data.subscriberId,
			workspaceId: data.workspaceId,
			eventType: data.eventType,
			category: data.category,
			channel: data.channel,
			status: data.status ?? "pending",
			deliveryAddress: data.deliveryAddress,
			attempts: 0,
			payload: data.payload ?? {},
			metadata: data.metadata ?? {},
			idempotencyKey: data.idempotencyKey,
			createdAt: new Date(Date.now() + this.counter),
		};
		this.store.set(record.id, record);
		return record;
	}

	async updateStatus(
		id: string,
		status: DeliveryStatus,
		metadata?: UpdateNotificationStatusData,
	): Promise<void> {
		const existing = this.store.get(id);
		if (!existing) {
			throw new Error(`Notification not found: ${id}`);
		}
		this.store.set(id, { ...existing, status, ...metadata });
	}

	async findById(id: string): Promise<NotificationRecord | null> {
		return this.store.get(id) ?? null;
	}

	async findByProviderMsgId(providerMsgId: string): Promise<NotificationRecord | null> {
		for (const record of this.store.values()) {
			if (record.providerMsgId === providerMsgId) return record;
		}
		return null;
	}

	async list(
		subscriberId: string,
		filter?: NotificationFilter,
	): Promise<CursorResult<NotificationRecord>> {
		let items = [...this.store.values()]
			.filter((n) => n.subscriberId === subscriberId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		if (filter?.status) items = items.filter((n) => n.status === filter.status);
		if (filter?.category) items = items.filter((n) => n.category === filter.category);
		if (filter?.channel) items = items.filter((n) => n.channel === filter.channel);
		if (filter?.since)
			items = items.filter((n) => filter.since != null && n.createdAt >= filter.since);
		if (filter?.until)
			items = items.filter((n) => filter.until != null && n.createdAt <= filter.until);

		return applyInMemoryCursor(items, (n) => n.createdAt, filter?.cursor, filter?.limit);
	}

	async listCrossWorkspace(filter?: NotificationFilter): Promise<CursorResult<NotificationRecord>> {
		let items = [...this.store.values()].sort(
			(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
		);

		if (filter?.status) items = items.filter((n) => n.status === filter.status);
		if (filter?.category) items = items.filter((n) => n.category === filter.category);
		if (filter?.channel) items = items.filter((n) => n.channel === filter.channel);
		if (filter?.since)
			items = items.filter((n) => filter.since != null && n.createdAt >= filter.since);
		if (filter?.until)
			items = items.filter((n) => filter.until != null && n.createdAt <= filter.until);

		return applyInMemoryCursor(items, (n) => n.createdAt, filter?.cursor, filter?.limit);
	}

	clear(): void {
		this.store.clear();
		this.counter = 0;
	}
}
