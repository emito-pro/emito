import type { CreateInboxData, CursorResult, InboxFilter, InboxRecord } from "./types";

export interface InboxRepository {
	create(data: CreateInboxData): Promise<InboxRecord>;
	findById(id: string): Promise<InboxRecord | undefined>;
	findBySubscriber(subscriberId: string, filter?: InboxFilter): Promise<CursorResult<InboxRecord>>;
	updateReadAt(id: string): Promise<void>;
	updateArchivedAt(id: string): Promise<void>;
	unreadCount(subscriberId: string): Promise<number>;
	updateSnoozedUntil(id: string, snoozedUntil: Date): Promise<void>;
	markAllRead(subscriberId: string): Promise<void>;
	clearReadAt(id: string): Promise<void>;
	clearArchivedAt(id: string): Promise<void>;
}
