import type { DeadLetterRepository } from "../dead-letter-repository";
import type {
	CreateDeadLetterData,
	CursorResult,
	DeadLetterFilter,
	DeadLetterRecord,
} from "../types";
import { applyInMemoryCursor } from "./cursor-helpers";

export class InMemoryDeadLetterRepository implements DeadLetterRepository {
	private store = new Map<string, DeadLetterRecord>();
	private counter = 0;

	async create(data: CreateDeadLetterData): Promise<DeadLetterRecord> {
		this.counter++;
		const record: DeadLetterRecord = {
			id: `dlq_mem_${String(this.counter).padStart(6, "0")}`,
			notificationId: data.notificationId,
			subscriberId: data.subscriberId,
			eventType: data.eventType,
			channel: data.channel,
			attempts: data.attempts,
			payload: data.payload,
			exhaustedAt: new Date(Date.now() + this.counter),
		};
		this.store.set(record.id, record);
		return record;
	}

	async list(filter?: DeadLetterFilter): Promise<CursorResult<DeadLetterRecord>> {
		let items = [...this.store.values()].sort(
			(a, b) => b.exhaustedAt.getTime() - a.exhaustedAt.getTime(),
		);

		// Default to unresolved only
		const resolved = filter?.resolved ?? false;
		if (!resolved) {
			items = items.filter((d) => d.resolvedAt == null);
		}

		return applyInMemoryCursor(items, (d) => d.exhaustedAt, filter?.cursor, filter?.limit);
	}

	async findById(id: string): Promise<DeadLetterRecord | null> {
		return this.store.get(id) ?? null;
	}

	async resolve(id: string, resolution: string): Promise<void> {
		const existing = this.store.get(id);
		if (!existing) throw new Error(`Dead letter not found: ${id}`);
		this.store.set(id, {
			...existing,
			resolvedAt: new Date(),
			resolution,
		});
	}

	async unresolve(id: string): Promise<void> {
		const existing = this.store.get(id);
		if (!existing) throw new Error(`Dead letter not found: ${id}`);
		this.store.set(id, {
			...existing,
			resolvedAt: undefined,
			resolution: undefined,
		});
	}

	async purgeResolved(): Promise<number> {
		let purged = 0;
		for (const [id, record] of this.store) {
			if (record.resolvedAt != null) {
				this.store.delete(id);
				purged += 1;
			}
		}
		return purged;
	}

	async findAllForAdmin(): Promise<DeadLetterRecord[]> {
		return [...this.store.values()].sort(
			(a, b) => b.exhaustedAt.getTime() - a.exhaustedAt.getTime(),
		);
	}

	getAll(): DeadLetterRecord[] {
		return [...this.store.values()];
	}

	clear(): void {
		this.store.clear();
		this.counter = 0;
	}
}
