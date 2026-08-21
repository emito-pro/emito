import type { ListRepository } from "../repositories/list-repository";
import type {
	CreateListData,
	CursorResult,
	ListFilter,
	ListRecord,
	UpdateListData,
} from "../repositories/types";

export interface ListServiceDeps {
	listRepository: ListRepository;
}

export class ListService {
	private readonly listRepository: ListRepository;

	constructor(deps: ListServiceDeps) {
		this.listRepository = deps.listRepository;
	}

	async create(data: CreateListData): Promise<ListRecord> {
		return this.listRepository.create(data);
	}

	async findById(id: string): Promise<ListRecord | null> {
		return this.listRepository.findById(id);
	}

	async findBySlug(slug: string): Promise<ListRecord | null> {
		return this.listRepository.findBySlug(slug);
	}

	async list(filter?: ListFilter): Promise<CursorResult<ListRecord>> {
		return this.listRepository.list(filter);
	}

	async update(id: string, data: UpdateListData): Promise<ListRecord> {
		return this.listRepository.update(id, data);
	}

	async archive(id: string): Promise<ListRecord> {
		return this.listRepository.archive(id);
	}
}
