import type { WorkspaceDefault } from "@emito/types";
import type {
	UpsertWorkspaceDefaultData,
	WorkspaceDefaultRepository,
} from "../workspace-default-repository";

export class InMemoryWorkspaceDefaultRepository implements WorkspaceDefaultRepository {
	private store: WorkspaceDefault[] = [];

	async findByWorkspace(workspaceId: string, topicKey?: string): Promise<WorkspaceDefault[]> {
		return this.store.filter((d) => {
			if (d.workspaceId !== workspaceId) return false;
			if (topicKey !== undefined && d.topicKey !== topicKey) return false;
			return true;
		});
	}

	async listByWorkspace(workspaceId: string): Promise<WorkspaceDefault[]> {
		return this.findByWorkspace(workspaceId);
	}

	async upsert(data: UpsertWorkspaceDefaultData): Promise<WorkspaceDefault> {
		const idx = this.store.findIndex(
			(d) =>
				d.workspaceId === data.workspaceId &&
				d.topicKey === data.topicKey &&
				d.channel === data.channel,
		);

		const record: WorkspaceDefault = {
			workspaceId: data.workspaceId,
			topicKey: data.topicKey,
			channel: data.channel,
			enabled: data.enabled,
			isMandatory: data.isMandatory,
		};

		if (idx >= 0) {
			this.store[idx] = record;
		} else {
			this.store.push(record);
		}
		return record;
	}

	seed(defaults: WorkspaceDefault): void {
		this.store.push(defaults);
	}

	clear(): void {
		this.store = [];
	}
}
