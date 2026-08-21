import type { Channel } from "@emito/types";
import type { ApiPage } from "../admin-types";
import type { SuppressionRepository } from "../suppression-repository";
import type {
	CreateSuppressionData,
	CursorResult,
	SuppressionAdminFilter,
	SuppressionFilter,
	SuppressionRecord,
} from "../types";
import { normalizeLimit, sliceToApiPage } from "./admin-cursor-helpers";
import { applyInMemoryCursor } from "./cursor-helpers";

export class InMemorySuppressionRepository implements SuppressionRepository {
	private records: SuppressionRecord[] = [];
	private counter = 0;

	async findById(id: string): Promise<SuppressionRecord | null> {
		return this.records.find((r) => r.id === id) ?? null;
	}

	async findByAddressAndChannel(
		address: string,
		channel: Channel,
	): Promise<SuppressionRecord | null> {
		return (
			this.records.find(
				(r) => r.address === address && r.channel === channel && r.archivedAt == null,
			) ?? null
		);
	}

	async create(data: CreateSuppressionData): Promise<SuppressionRecord> {
		this.counter++;
		const now = new Date(Date.now() + this.counter);
		const record: SuppressionRecord = {
			id: `sup_mem_${String(this.counter).padStart(6, "0")}`,
			address: data.address,
			channel: data.channel,
			reason: data.reason,
			provider: data.provider,
			providerMsgId: data.providerMsgId,
			consecutiveSoft: 0,
			createdAt: now,
			updatedAt: now,
		};
		this.records.push(record);
		return record;
	}

	async archive(address: string, channel: Channel): Promise<boolean> {
		const active = this.records.find(
			(r) => r.address === address && r.channel === channel && r.archivedAt == null,
		);
		if (!active) return false;
		const now = new Date();
		active.archivedAt = now;
		active.updatedAt = now;
		return true;
	}

	async list(filter?: SuppressionFilter): Promise<CursorResult<SuppressionRecord>> {
		let items = [...this.records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		if (!filter?.includeArchived) {
			items = items.filter((r) => r.archivedAt == null);
		}

		if (filter?.channel) {
			items = items.filter((s) => s.channel === filter.channel);
		}

		return applyInMemoryCursor(items, (s) => s.createdAt, filter?.cursor, filter?.limit);
	}

	async listForAdmin(filter?: SuppressionAdminFilter): Promise<ApiPage<SuppressionRecord>> {
		let items = [...this.records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		if (!filter?.includeArchived) {
			items = items.filter((r) => r.archivedAt == null);
		}
		if (filter?.channels && filter.channels.length > 0) {
			const set = new Set(filter.channels);
			items = items.filter((r) => set.has(r.channel));
		}
		if (filter?.reasons && filter.reasons.length > 0) {
			const set = new Set(filter.reasons);
			items = items.filter((r) => set.has(r.reason));
		}
		if (filter?.providers && filter.providers.length > 0) {
			const set = new Set(filter.providers);
			items = items.filter((r) => r.provider != null && set.has(r.provider));
		}
		if (filter?.addressSearch && filter.addressSearch.trim().length > 0) {
			const needle = filter.addressSearch.trim().toLowerCase();
			items = items.filter((r) => r.address.toLowerCase().includes(needle));
		}
		if (filter?.addedFrom) {
			const fromMs = filter.addedFrom.getTime();
			items = items.filter((r) => r.createdAt.getTime() >= fromMs);
		}
		if (filter?.addedTo) {
			const toMs = filter.addedTo.getTime();
			items = items.filter((r) => r.createdAt.getTime() <= toMs);
		}

		return sliceToApiPage(items, (s) => s.createdAt, filter?.cursor, normalizeLimit(filter?.limit));
	}

	clear(): void {
		this.records = [];
		this.counter = 0;
	}
}
