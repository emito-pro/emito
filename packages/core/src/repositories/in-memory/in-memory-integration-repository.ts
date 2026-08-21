import { type Channel, EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type {
	CreateIntegrationData,
	IntegrationRepository,
	IntegrationRoutingQuery,
	UpdateIntegrationData,
} from "../integration-repository";
import type { IntegrationRecord } from "../types";

export class InMemoryIntegrationRepository implements IntegrationRepository {
	private store: IntegrationRecord[] = [];

	async findBySubscriberAndChannel(
		subscriberId: string,
		channel: Channel,
	): Promise<IntegrationRecord[]> {
		return this.store.filter(
			(i) => i.subscriberId === subscriberId && i.channel === channel && i.active,
		);
	}

	async findForRouting(query: IntegrationRoutingQuery): Promise<IntegrationRecord[]> {
		return this.store.filter((i) => {
			if (!i.active) return false;
			if (i.channel !== query.channel) return false;
			if (i.ownerId !== query.workspaceId) return false;
			if (i.subscriberId !== undefined && i.subscriberId !== query.subscriberId) return false;
			if (i.events !== undefined && !i.events.includes(query.eventType)) return false;
			return true;
		});
	}

	async listByWorkspace(workspaceId: string): Promise<IntegrationRecord[]> {
		return this.store.filter((i) => i.ownerId === workspaceId && i.active);
	}

	async listBySubscriber(subscriberId: string): Promise<IntegrationRecord[]> {
		return this.store.filter((i) => i.subscriberId === subscriberId && i.active);
	}

	async findById(id: string): Promise<IntegrationRecord | undefined> {
		return this.store.find((i) => i.id === id);
	}

	private counter = 0;

	async create(data: CreateIntegrationData): Promise<IntegrationRecord> {
		this.counter++;
		const record: IntegrationRecord = {
			id: `int_mem_${String(this.counter).padStart(6, "0")}`,
			ownerId: data.ownerId,
			subscriberId: data.subscriberId,
			name: data.name,
			channel: data.channel,
			events: data.events,
			config: data.config,
			secretFields: data.secretFields,
			active: true,
			createdAt: new Date(),
		};
		this.store.push(record);
		return record;
	}

	async update(id: string, data: UpdateIntegrationData): Promise<IntegrationRecord> {
		const idx = this.store.findIndex((i) => i.id === id);
		if (idx < 0)
			throw new EmitoError({
				code: EMITO_ERROR_CODE.INTEGRATION_NOT_FOUND,
				message: `Integration not found: ${id}`,
			});
		// biome-ignore lint/style/noNonNullAssertion: idx >= 0 guaranteed by guard + throw above
		const existing = this.store[idx]!;
		const updated: IntegrationRecord = {
			...existing,
			name: data.name ?? existing.name,
			events: data.events ?? existing.events,
			config: data.config ?? existing.config,
		};
		this.store[idx] = updated;
		return updated;
	}

	async deactivate(id: string): Promise<void> {
		const idx = this.store.findIndex((i) => i.id === id);
		if (idx < 0)
			throw new EmitoError({
				code: EMITO_ERROR_CODE.INTEGRATION_NOT_FOUND,
				message: `Integration not found: ${id}`,
			});
		// biome-ignore lint/style/noNonNullAssertion: idx >= 0 guaranteed by guard + throw above
		this.store[idx] = { ...this.store[idx]!, active: false };
	}

	getAll(): IntegrationRecord[] {
		return [...this.store];
	}

	seed(integration: IntegrationRecord): void {
		this.store.push(integration);
	}

	clear(): void {
		this.store = [];
	}
}
