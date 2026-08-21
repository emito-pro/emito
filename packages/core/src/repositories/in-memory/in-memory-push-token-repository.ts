import type { PushTokenRecord, PushTokenRepository } from "../push-token-repository";

export interface InMemoryPushTokenRecord {
	id: string;
	token: string;
	subscriberId: string;
	platform: string;
	deviceName: string | null;
	active: boolean;
	lastUsedAt: Date | null;
	createdAt: Date;
}

export class InMemoryPushTokenRepository implements PushTokenRepository {
	private records: InMemoryPushTokenRecord[] = [];
	private seq = 0;

	async deactivateByToken(token: string): Promise<void> {
		for (const record of this.records) {
			if (record.token === token) {
				record.active = false;
			}
		}
	}

	async listBySubscriber(subscriberId: string): Promise<PushTokenRecord[]> {
		return this.records
			.filter((r) => r.subscriberId === subscriberId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			.map((r) => ({ ...r }));
	}

	async deactivateById(id: string, subscriberId: string): Promise<boolean> {
		const record = this.records.find((r) => r.id === id && r.subscriberId === subscriberId);
		if (record === undefined) return false;
		record.active = false;
		return true;
	}

	/**
	 * Seed a token for tests. Accepts the full record fields with sensible defaults
	 * so callers can add a minimal `(token, subscriberId)` pair or a richer device row.
	 */
	addToken(
		token: string,
		subscriberId: string,
		overrides: Partial<Omit<InMemoryPushTokenRecord, "token" | "subscriberId">> = {},
	): InMemoryPushTokenRecord {
		this.seq += 1;
		const record: InMemoryPushTokenRecord = {
			id: overrides.id ?? `ptk_mem_${this.seq}`,
			token,
			subscriberId,
			platform: overrides.platform ?? "web",
			deviceName: overrides.deviceName ?? null,
			active: overrides.active ?? true,
			lastUsedAt: overrides.lastUsedAt ?? null,
			createdAt: overrides.createdAt ?? new Date(),
		};
		this.records.push(record);
		return record;
	}

	findByToken(token: string): InMemoryPushTokenRecord | undefined {
		return this.records.find((r) => r.token === token);
	}

	clear(): void {
		this.records = [];
	}
}
