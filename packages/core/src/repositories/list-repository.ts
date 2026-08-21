import type { CreateListData, CursorResult, ListFilter, ListRecord, UpdateListData } from "./types";

export interface ListRepository {
	create(data: CreateListData): Promise<ListRecord>;
	findById(id: string): Promise<ListRecord | null>;
	findBySlug(slug: string): Promise<ListRecord | null>;
	list(filter?: ListFilter): Promise<CursorResult<ListRecord>>;
	update(id: string, data: UpdateListData): Promise<ListRecord>;
	archive(id: string): Promise<ListRecord>;
	updateMemberCount(id: string, delta: number): Promise<void>;
}
