import type { PreferenceRecord } from "@emito/types";
import type {
	PreferenceFilter,
	PreferenceRepository,
	UpsertPreferenceData,
} from "../preference-repository";

export class InMemoryPreferenceRepository implements PreferenceRepository {
	private store: PreferenceRecord[] = [];

	async findBySubscriber(
		subscriberId: string,
		filter?: PreferenceFilter,
	): Promise<PreferenceRecord[]> {
		return this.store.filter((p) => {
			if (p.subscriberId !== subscriberId) return false;
			if (filter?.workspaceId !== undefined) {
				if (filter.workspaceId === null) {
					if (p.workspaceId !== undefined) return false;
				} else if (p.workspaceId !== filter.workspaceId) {
					return false;
				}
			}
			if (filter?.topicKey !== undefined && p.topicKey !== filter.topicKey) {
				return false;
			}
			if (filter?.channel !== undefined && p.channel !== filter.channel) {
				return false;
			}
			return true;
		});
	}

	async listBySubscriber(subscriberId: string): Promise<PreferenceRecord[]> {
		return this.store.filter((p) => p.subscriberId === subscriberId);
	}

	async upsert(data: UpsertPreferenceData): Promise<PreferenceRecord> {
		const idx = this.store.findIndex(
			(p) =>
				p.subscriberId === data.subscriberId &&
				p.topicKey === data.topicKey &&
				p.channel === data.channel &&
				(data.workspaceId === null || data.workspaceId === undefined
					? p.workspaceId === undefined
					: p.workspaceId === data.workspaceId),
		);

		const record: PreferenceRecord = {
			subscriberId: data.subscriberId,
			workspaceId: data.workspaceId === null ? undefined : data.workspaceId,
			topicKey: data.topicKey,
			channel: data.channel,
			enabled: data.enabled,
		};

		if (idx >= 0) {
			this.store[idx] = record;
		} else {
			this.store.push(record);
		}
		return record;
	}

	async reset(subscriberId: string, workspaceId?: string | null): Promise<void> {
		this.store = this.store.filter((p) => {
			if (p.subscriberId !== subscriberId) return true;
			if (workspaceId === null) return p.workspaceId !== undefined;
			if (workspaceId === undefined) return false;
			return p.workspaceId !== workspaceId;
		});
	}

	async listByWorkspace(workspaceId: string): Promise<PreferenceRecord[]> {
		return this.store.filter((p) => p.workspaceId === workspaceId);
	}

	seed(preference: PreferenceRecord): void {
		this.store.push(preference);
	}

	clear(): void {
		this.store = [];
	}
}
