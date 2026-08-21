import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ListMemberRepository } from "../list-member-repository";
import type {
	CreateListMemberData,
	CursorResult,
	ListMemberFilter,
	ListMemberRecord,
	ListMemberStatus,
} from "../types";
import { applyInMemoryCursor } from "./cursor-helpers";

export class InMemoryListMemberRepository implements ListMemberRepository {
	private records: ListMemberRecord[] = [];
	private counter = 0;

	async subscribe(
		data: CreateListMemberData,
	): Promise<{ member: ListMemberRecord; created: boolean }> {
		const existing = this.records.find(
			(r) => r.subscriberId === data.subscriberId && r.listId === data.listId,
		);
		if (existing) {
			return { member: existing, created: false };
		}

		this.counter++;
		const record: ListMemberRecord = {
			id: `lmb_mem_${String(this.counter).padStart(6, "0")}`,
			subscriberId: data.subscriberId,
			listId: data.listId,
			status: "unconfirmed",
			source: data.source,
			subscribedAt: new Date(),
			confirmedAt: undefined,
			unsubscribedAt: undefined,
			createdAt: new Date(),
		};
		this.records.push(record);
		return { member: record, created: true };
	}

	async confirm(subscriberId: string, listId: string): Promise<ListMemberRecord> {
		const record = this.records.find((r) => r.subscriberId === subscriberId && r.listId === listId);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: "List membership not found",
				isRetryable: false,
			});
		}
		record.status = "confirmed";
		record.confirmedAt = new Date();
		return record;
	}

	async unsubscribe(subscriberId: string, listId: string): Promise<ListMemberRecord> {
		const record = this.records.find((r) => r.subscriberId === subscriberId && r.listId === listId);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: "List membership not found",
				isRetryable: false,
			});
		}
		record.status = "unsubscribed";
		record.unsubscribedAt = new Date();
		return record;
	}

	async findBySubscriberAndList(
		subscriberId: string,
		listId: string,
	): Promise<ListMemberRecord | null> {
		return this.records.find((r) => r.subscriberId === subscriberId && r.listId === listId) ?? null;
	}

	async listByList(
		listId: string,
		filter?: ListMemberFilter,
	): Promise<CursorResult<ListMemberRecord>> {
		let items = [...this.records]
			.filter((r) => r.listId === listId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		if (filter?.status) {
			items = items.filter((r) => r.status === filter.status);
		}

		return applyInMemoryCursor(items, (r) => r.createdAt, filter?.cursor, filter?.limit);
	}

	async listBySubscriber(
		subscriberId: string,
		filter?: ListMemberFilter,
	): Promise<CursorResult<ListMemberRecord>> {
		let items = [...this.records]
			.filter((r) => r.subscriberId === subscriberId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		if (filter?.status) {
			items = items.filter((r) => r.status === filter.status);
		}

		return applyInMemoryCursor(items, (r) => r.createdAt, filter?.cursor, filter?.limit);
	}

	async countConfirmed(listId: string): Promise<number> {
		return this.records.filter((r) => r.listId === listId && r.status === "confirmed").length;
	}

	async countByList(listId: string, status?: ListMemberStatus): Promise<number> {
		return this.records.filter(
			(r) => r.listId === listId && (status === undefined || r.status === status),
		).length;
	}

	async deleteExpiredUnconfirmed(olderThan: Date): Promise<number> {
		const before = this.records.length;
		this.records = this.records.filter(
			(r) => !(r.status === "unconfirmed" && r.createdAt < olderThan),
		);
		return before - this.records.length;
	}

	seed(record: ListMemberRecord): void {
		this.records.push(record);
	}

	clear(): void {
		this.records = [];
		this.counter = 0;
	}
}
