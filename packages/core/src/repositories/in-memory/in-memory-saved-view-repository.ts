import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ApiPage, SavedViewCreate, SavedViewPatch, SavedViewRecord } from "../admin-types";
import type { SavedViewRepository } from "../saved-view-repository";
import { sliceToApiPage } from "./admin-cursor-helpers";
import { nextId } from "./admin-ids";

/**
 * In-memory {@link SavedViewRepository} for unit tests.
 *
 * `list` is user-scoped and pages newest-first by `createdAt`. `create` enforces the
 * `(createdByUserId, name, page)` uniqueness constraint, throwing `RESOURCE_CONFLICT` on a
 * duplicate, exactly as the Drizzle unique index does.
 */
export class InMemorySavedViewRepository implements SavedViewRepository {
	private readonly records = new Map<string, SavedViewRecord>();

	async list(opts: {
		userId: string;
		page?: string;
		cursor?: string | null;
		limit: number;
	}): Promise<ApiPage<SavedViewRecord>> {
		const filtered = [...this.records.values()].filter((r) => {
			if (r.createdByUserId !== opts.userId) return false;
			if (opts.page !== undefined && r.page !== opts.page) return false;
			return true;
		});

		filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		return sliceToApiPage(filtered, (r) => r.createdAt, opts.cursor, opts.limit);
	}

	async findById(id: string): Promise<SavedViewRecord | null> {
		return this.records.get(id) ?? null;
	}

	async create(input: SavedViewCreate): Promise<SavedViewRecord> {
		const duplicate = [...this.records.values()].find(
			(r) =>
				r.createdByUserId === input.createdByUserId &&
				r.name === input.name &&
				r.page === input.page,
		);
		if (duplicate) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
				message: `Saved view "${input.name}" already exists on page "${input.page}" for this user`,
				isRetryable: false,
				context: { name: input.name, page: input.page, userId: input.createdByUserId },
			});
		}

		const now = new Date();
		const record: SavedViewRecord = {
			id: nextId("sav"),
			name: input.name,
			page: input.page,
			filters: input.filters ?? {},
			scope: input.scope ?? "private",
			createdByUserId: input.createdByUserId,
			createdAt: now,
			updatedAt: now,
		};
		this.records.set(record.id, record);
		return record;
	}

	async update(id: string, patch: SavedViewPatch): Promise<SavedViewRecord> {
		const record = this.requireRecord(id);
		const updated: SavedViewRecord = {
			...record,
			name: patch.name ?? record.name,
			filters: patch.filters ?? record.filters,
			scope: patch.scope ?? record.scope,
			updatedAt: new Date(),
		};
		this.records.set(id, updated);
		return updated;
	}

	async delete(id: string): Promise<void> {
		this.requireRecord(id);
		this.records.delete(id);
	}

	private requireRecord(id: string): SavedViewRecord {
		const record = this.records.get(id);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
				message: `Saved view "${id}" not found`,
				isRetryable: false,
				context: { id },
			});
		}
		return record;
	}

	/** Test helper: drop all records. */
	clear(): void {
		this.records.clear();
	}
}
