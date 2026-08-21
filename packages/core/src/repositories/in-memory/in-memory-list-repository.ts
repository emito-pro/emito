import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ListRepository } from "../list-repository";
import type {
	CreateListData,
	CursorResult,
	ListFilter,
	ListRecord,
	UpdateListData,
} from "../types";
import { applyInMemoryCursor } from "./cursor-helpers";

export class InMemoryListRepository implements ListRepository {
	private records: ListRecord[] = [];
	private counter = 0;

	async create(data: CreateListData): Promise<ListRecord> {
		const existing = this.records.find((r) => r.slug === data.slug);
		if (existing) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: `List with slug "${data.slug}" already exists`,
				isRetryable: false,
			});
		}

		this.counter++;
		const record: ListRecord = {
			id: `lst_mem_${String(this.counter).padStart(6, "0")}`,
			name: data.name,
			slug: data.slug,
			description: data.description,
			optinType: data.optinType ?? "single",
			visibility: data.visibility ?? "private",
			categoryId: data.categoryId,
			memberCount: 0,
			archivedAt: undefined,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		this.records.push(record);
		return record;
	}

	async findById(id: string): Promise<ListRecord | null> {
		return this.records.find((r) => r.id === id) ?? null;
	}

	async findBySlug(slug: string): Promise<ListRecord | null> {
		return this.records.find((r) => r.slug === slug && !r.archivedAt) ?? null;
	}

	async list(filter?: ListFilter): Promise<CursorResult<ListRecord>> {
		let items = [...this.records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		if (filter?.archived === false) {
			items = items.filter((r) => !r.archivedAt);
		} else if (filter?.archived === true) {
			items = items.filter((r) => !!r.archivedAt);
		}

		return applyInMemoryCursor(items, (r) => r.createdAt, filter?.cursor, filter?.limit);
	}

	async update(id: string, data: UpdateListData): Promise<ListRecord> {
		const record = this.records.find((r) => r.id === id);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: `List "${id}" not found`,
				isRetryable: false,
			});
		}
		if (data.name !== undefined) record.name = data.name;
		if (data.description !== undefined) record.description = data.description;
		record.updatedAt = new Date();
		return record;
	}

	async archive(id: string): Promise<ListRecord> {
		const record = this.records.find((r) => r.id === id);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: `List "${id}" not found`,
				isRetryable: false,
			});
		}
		record.archivedAt = new Date();
		record.updatedAt = new Date();
		return record;
	}

	async updateMemberCount(id: string, delta: number): Promise<void> {
		const record = this.records.find((r) => r.id === id);
		if (record) {
			record.memberCount = Math.max(0, record.memberCount + delta);
		}
	}

	seed(record: ListRecord): void {
		this.records.push(record);
	}

	clear(): void {
		this.records = [];
		this.counter = 0;
	}
}
