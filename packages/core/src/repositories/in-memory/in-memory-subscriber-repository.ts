import type { Subscriber } from "@emito/types";
import type { RepositoryTx } from "../admin-types";
import type { SubscriberEraseCounts, SubscriberRepository } from "../subscriber-repository";
import type { CreateSubscriberData, CursorFilter, CursorResult } from "../types";
import { applyInMemoryCursor } from "./cursor-helpers";

export class InMemorySubscriberRepository implements SubscriberRepository {
	private store = new Map<string, Subscriber>();

	async findById(id: string): Promise<Subscriber | null> {
		return this.store.get(id) ?? null;
	}

	async findByIds(ids: readonly string[]): Promise<Subscriber[]> {
		if (ids.length === 0) return [];
		const wanted = new Set(ids);
		return [...this.store.values()].filter((s) => wanted.has(s.id));
	}

	async update(
		id: string,
		data: Partial<Omit<Subscriber, "id" | "createdAt">>,
	): Promise<Subscriber> {
		const existing = this.store.get(id);
		if (!existing) {
			throw new Error(`Subscriber not found: ${id}`);
		}
		const updated = { ...existing, ...data, updatedAt: new Date() };
		this.store.set(id, updated);
		return updated;
	}

	async list(filter?: CursorFilter): Promise<CursorResult<Subscriber>> {
		const items = [...this.store.values()]
			.filter((s) => s.erasedAt == null)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		return applyInMemoryCursor(items, (s) => s.createdAt, filter?.cursor, filter?.limit);
	}

	async create(data: CreateSubscriberData): Promise<Subscriber> {
		const now = new Date();
		const subscriber: Subscriber = {
			id: data.id,
			email: data.email,
			phone: data.phone,
			lang: data.lang,
			locale: data.locale,
			timezone: data.timezone,
			metadata: data.metadata ?? {},
			createdAt: now,
			updatedAt: now,
		};
		this.store.set(subscriber.id, subscriber);
		return subscriber;
	}

	async upsert(data: CreateSubscriberData): Promise<Subscriber> {
		const existing = this.store.get(data.id);
		if (!existing) {
			return this.create(data);
		}
		const updated: Subscriber = {
			...existing,
			email: data.email ?? existing.email,
			phone: data.phone ?? existing.phone,
			lang: data.lang ?? existing.lang,
			locale: data.locale ?? existing.locale,
			timezone: data.timezone ?? existing.timezone,
			metadata: data.metadata ?? existing.metadata,
			updatedAt: new Date(),
		};
		this.store.set(updated.id, updated);
		return updated;
	}

	/**
	 * Anonymise the subscriber row (clear `email`/`phone`/`metadata`, stamp `erasedAt`).
	 *
	 * The in-memory repository owns only the subscriber store, so it cannot cascade to
	 * the dependent collections (notifications, inbox, push tokens, …) that the Drizzle
	 * implementation scrubs — those live in their own isolated in-memory repositories.
	 * The returned counts therefore reflect exactly what *this* repository mutated:
	 * the subscriber row only, hence zero for every dependent collection. The optional
	 * transaction handle is ignored (the in-memory store has no transactions).
	 */
	async erase(id: string, _tx?: RepositoryTx): Promise<SubscriberEraseCounts> {
		const existing = this.store.get(id);
		if (!existing) throw new Error(`Subscriber not found: ${id}`);
		this.store.set(id, {
			...existing,
			email: undefined,
			phone: undefined,
			metadata: {},
			erasedAt: new Date(),
			updatedAt: new Date(),
		});
		return {
			notifications: 0,
			inboxItems: 0,
			pushTokens: 0,
			personalIntegrations: 0,
			preferences: 0,
			deadLetters: 0,
		};
	}

	seed(subscriber: Subscriber): void {
		this.store.set(subscriber.id, subscriber);
	}

	clear(): void {
		this.store.clear();
	}
}
