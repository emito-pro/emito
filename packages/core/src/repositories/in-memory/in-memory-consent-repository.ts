import type { ConsentRepository } from "../consent-repository";
import type { ConsentFilter, ConsentRecord, CreateConsentData, CursorResult } from "../types";
import { applyInMemoryCursor } from "./cursor-helpers";

export class InMemoryConsentRepository implements ConsentRepository {
	private records: ConsentRecord[] = [];
	private counter = 0;

	async recordConsent(data: CreateConsentData): Promise<ConsentRecord> {
		this.counter++;
		const record: ConsentRecord = {
			id: `con_mem_${String(this.counter).padStart(6, "0")}`,
			subscriberId: data.subscriberId,
			category: data.category,
			topicSlug: data.topicSlug,
			consented: data.consented,
			ipAddress: data.ipAddress,
			userAgent: data.userAgent,
			source: data.source,
			createdAt: new Date(Date.now() + this.counter),
		};
		this.records.push(record);
		return record;
	}

	async getLatestConsent(subscriberId: string, category: string): Promise<ConsentRecord | null> {
		const matching = this.records
			.filter((r) => r.subscriberId === subscriberId && r.category === category)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		return matching[0] ?? null;
	}

	async listConsentHistory(
		subscriberId: string,
		filter?: ConsentFilter,
	): Promise<CursorResult<ConsentRecord>> {
		let items = [...this.records]
			.filter((r) => r.subscriberId === subscriberId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		if (filter?.category) {
			items = items.filter((r) => r.category === filter.category);
		}

		return applyInMemoryCursor(items, (r) => r.createdAt, filter?.cursor, filter?.limit);
	}

	async listAll(filter?: ConsentFilter): Promise<CursorResult<ConsentRecord>> {
		let items = [...this.records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		if (filter?.subscriberId) {
			items = items.filter((r) => r.subscriberId === filter.subscriberId);
		}

		if (filter?.category) {
			items = items.filter((r) => r.category === filter.category);
		}

		return applyInMemoryCursor(items, (r) => r.createdAt, filter?.cursor, filter?.limit);
	}

	seed(record: ConsentRecord): void {
		this.records.push(record);
	}

	clear(): void {
		this.records = [];
		this.counter = 0;
	}
}
