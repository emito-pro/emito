import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { InboxRepository } from "../inbox-repository";
import type { CreateInboxData, CursorResult, InboxFilter, InboxRecord } from "../types";
import { applyInMemoryCursor } from "./cursor-helpers";

export class InMemoryInboxRepository implements InboxRepository {
	private store = new Map<string, InboxRecord>();
	private counter = 0;

	async create(data: CreateInboxData): Promise<InboxRecord> {
		this.counter++;
		const record: InboxRecord = {
			id: `inbox_mem_${String(this.counter).padStart(6, "0")}`,
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
			createdAt: new Date(Date.now() + this.counter),
		};
		this.store.set(record.id, record);
		return record;
	}

	async findById(id: string): Promise<InboxRecord | undefined> {
		return this.store.get(id);
	}

	async findBySubscriber(
		subscriberId: string,
		filter?: InboxFilter,
	): Promise<CursorResult<InboxRecord>> {
		const now = new Date();
		let items = [...this.store.values()]
			.filter((r) => r.subscriberId === subscriberId)
			.filter((r) => !r.snoozedUntil || r.snoozedUntil <= now)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		if (filter?.status === "unread") {
			items = items.filter((r) => r.readAt == null && r.archivedAt == null);
		} else if (filter?.status === "read") {
			items = items.filter((r) => r.readAt != null && r.archivedAt == null);
		} else if (filter?.status === "archived") {
			items = items.filter((r) => r.archivedAt != null);
		}
		if (filter?.category) {
			items = items.filter((r) => r.category === filter.category);
		}

		return applyInMemoryCursor(items, (r) => r.createdAt, filter?.cursor, filter?.limit);
	}

	async updateReadAt(id: string): Promise<void> {
		const existing = this.store.get(id);
		if (!existing)
			throw new EmitoError({
				code: EMITO_ERROR_CODE.INBOX_NOT_FOUND,
				message: `Inbox item not found: ${id}`,
			});
		this.store.set(id, { ...existing, readAt: new Date() });
	}

	async updateArchivedAt(id: string): Promise<void> {
		const existing = this.store.get(id);
		if (!existing)
			throw new EmitoError({
				code: EMITO_ERROR_CODE.INBOX_NOT_FOUND,
				message: `Inbox item not found: ${id}`,
			});
		this.store.set(id, { ...existing, archivedAt: new Date() });
	}

	async unreadCount(subscriberId: string): Promise<number> {
		const now = new Date();
		return [...this.store.values()].filter(
			(r) =>
				r.subscriberId === subscriberId &&
				r.readAt == null &&
				r.archivedAt == null &&
				(!r.snoozedUntil || r.snoozedUntil <= now),
		).length;
	}

	async updateSnoozedUntil(id: string, snoozedUntil: Date): Promise<void> {
		const existing = this.store.get(id);
		if (!existing)
			throw new EmitoError({
				code: EMITO_ERROR_CODE.INBOX_NOT_FOUND,
				message: `Inbox item not found: ${id}`,
			});
		this.store.set(id, { ...existing, snoozedUntil });
	}

	async markAllRead(subscriberId: string): Promise<void> {
		const now = new Date();
		for (const [id, record] of this.store) {
			if (record.subscriberId === subscriberId && record.readAt == null) {
				this.store.set(id, { ...record, readAt: now });
			}
		}
	}

	async clearReadAt(id: string): Promise<void> {
		const existing = this.store.get(id);
		if (!existing)
			throw new EmitoError({
				code: EMITO_ERROR_CODE.INBOX_NOT_FOUND,
				message: `Inbox item not found: ${id}`,
			});
		this.store.set(id, { ...existing, readAt: undefined });
	}

	async clearArchivedAt(id: string): Promise<void> {
		const existing = this.store.get(id);
		if (!existing)
			throw new EmitoError({
				code: EMITO_ERROR_CODE.INBOX_NOT_FOUND,
				message: `Inbox item not found: ${id}`,
			});
		this.store.set(id, { ...existing, archivedAt: undefined });
	}

	seed(record: InboxRecord): void {
		this.store.set(record.id, record);
	}

	getAll(): InboxRecord[] {
		return [...this.store.values()];
	}

	clear(): void {
		this.store.clear();
		this.counter = 0;
	}
}
