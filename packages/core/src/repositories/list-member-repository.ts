import type {
	CreateListMemberData,
	CursorResult,
	ListMemberFilter,
	ListMemberRecord,
	ListMemberStatus,
} from "./types";

export interface ListMemberRepository {
	subscribe(data: CreateListMemberData): Promise<{ member: ListMemberRecord; created: boolean }>;
	confirm(subscriberId: string, listId: string): Promise<ListMemberRecord>;
	unsubscribe(subscriberId: string, listId: string): Promise<ListMemberRecord>;
	findBySubscriberAndList(subscriberId: string, listId: string): Promise<ListMemberRecord | null>;
	listByList(listId: string, filter?: ListMemberFilter): Promise<CursorResult<ListMemberRecord>>;
	listBySubscriber(
		subscriberId: string,
		filter?: ListMemberFilter,
	): Promise<CursorResult<ListMemberRecord>>;
	countConfirmed(listId: string): Promise<number>;
	/**
	 * Count a list's members in one `COUNT(*)` query, optionally filtered by status.
	 *
	 * The single-query counterpart to walking the membership pages: a list grid's
	 * footer total must not scale with the membership size. Omitting `status` counts
	 * every member of the list regardless of lifecycle.
	 */
	countByList(listId: string, status?: ListMemberStatus): Promise<number>;
	deleteExpiredUnconfirmed(olderThan: Date): Promise<number>;
}
