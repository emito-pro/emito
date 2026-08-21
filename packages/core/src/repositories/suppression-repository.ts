import type { Channel } from "@emito/types";
import type { ApiPage } from "./admin-types";
import type {
	CreateSuppressionData,
	CursorResult,
	SuppressionAdminFilter,
	SuppressionFilter,
	SuppressionRecord,
} from "./types";

export interface SuppressionRepository {
	findById(id: string): Promise<SuppressionRecord | null>;
	findByAddressAndChannel(address: string, channel: Channel): Promise<SuppressionRecord | null>;
	create(data: CreateSuppressionData): Promise<SuppressionRecord>;
	archive(address: string, channel: Channel): Promise<boolean>;
	list(filter?: SuppressionFilter): Promise<CursorResult<SuppressionRecord>>;
	/**
	 * Cursor-paginated list for the Suppression Management admin grid.
	 *
	 * Applies the rich {@link SuppressionAdminFilter} facets (address search,
	 * multi-channel/reason/provider, `addedAt` date bounds) and returns an
	 * {@link ApiPage} — `{ items, hasMore, cursor, total }` — where `total` is the
	 * full filtered count before slicing (drives the admin pagination footer).
	 * Rows are newest-first by `createdAt`.
	 *
	 * @param filter - Optional rich filter + cursor/limit. Omitted = active rows, page 1.
	 * @returns The page of matching suppression records.
	 */
	listForAdmin(filter?: SuppressionAdminFilter): Promise<ApiPage<SuppressionRecord>>;
}
