import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type {
	AdminBroadcastCreate,
	AdminBroadcastFilters,
	AdminBroadcastRecord,
	ApiPage,
	BroadcastCounters,
} from "../admin-types";
import type { BroadcastRepository } from "../broadcast-repository";
import { sliceToApiPage } from "./admin-cursor-helpers";
import { nextId } from "./admin-ids";

const TERMINAL_STATUSES = new Set(["sent", "cancelled"]);

const COUNTER_KEYS: readonly (keyof BroadcastCounters)[] = [
	"totalRecipients",
	"sentCount",
	"deliveredCount",
	"failedCount",
	"bouncedCount",
	"openedCount",
	"clickedCount",
	"unsubscribedCount",
];

/**
 * In-memory {@link BroadcastRepository} for unit tests.
 *
 * `list` pages newest-first by `createdAt`. `incrementCounters` applies signed deltas to the
 * funnel counters, clamping each at 0 (matching the Drizzle `GREATEST(0, …)` guard). `cancel`
 * rejects a terminal broadcast with `RESOURCE_CONFLICT`.
 */
export class InMemoryBroadcastRepository implements BroadcastRepository {
	private readonly records = new Map<string, AdminBroadcastRecord>();

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AdminBroadcastFilters;
	}): Promise<ApiPage<AdminBroadcastRecord>> {
		const f = opts.filters;
		const filtered = [...this.records.values()].filter((r) => {
			if (f?.listId !== undefined && r.listId !== f.listId) return false;
			if (f?.status !== undefined && f.status.length > 0 && !f.status.includes(r.status)) {
				return false;
			}
			if (f?.from !== undefined && r.createdAt.getTime() < f.from.getTime()) return false;
			if (f?.to !== undefined && r.createdAt.getTime() > f.to.getTime()) return false;
			if (f?.search !== undefined && f.search.length > 0) {
				const term = f.search.toLowerCase();
				if (!r.title.toLowerCase().includes(term) && !r.eventKey.toLowerCase().includes(term)) {
					return false;
				}
			}
			return true;
		});

		filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		return sliceToApiPage(filtered, (r) => r.createdAt, opts.cursor, opts.limit);
	}

	async findById(id: string): Promise<AdminBroadcastRecord | null> {
		return this.records.get(id) ?? null;
	}

	async create(input: AdminBroadcastCreate): Promise<AdminBroadcastRecord> {
		const record: AdminBroadcastRecord = {
			id: nextId("brc"),
			title: input.title,
			listId: input.listId,
			eventKey: input.eventKey,
			payload: input.payload ?? {},
			status: input.status ?? "scheduled",
			scheduledFor: input.scheduledFor ?? null,
			startedAt: input.startedAt ?? null,
			completedAt: null,
			totalRecipients: input.totalRecipients ?? 0,
			sentCount: 0,
			deliveredCount: 0,
			failedCount: 0,
			bouncedCount: 0,
			openedCount: 0,
			clickedCount: 0,
			unsubscribedCount: 0,
			createdByUserId: input.createdByUserId,
			createdAt: new Date(),
		};
		this.records.set(record.id, record);
		return record;
	}

	async cancel(id: string, _userId: string): Promise<AdminBroadcastRecord> {
		const record = this.requireRecord(id);
		if (TERMINAL_STATUSES.has(record.status)) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
				message: `Cannot cancel broadcast "${id}" in status "${record.status}"`,
				isRetryable: false,
				context: { id, status: record.status },
			});
		}
		const updated: AdminBroadcastRecord = { ...record, status: "cancelled" };
		this.records.set(id, updated);
		return updated;
	}

	async incrementCounters(id: string, deltas: Partial<BroadcastCounters>): Promise<void> {
		const record = this.requireRecord(id);
		const next: AdminBroadcastRecord = { ...record };
		for (const key of COUNTER_KEYS) {
			const delta = deltas[key];
			if (delta !== undefined) {
				next[key] = Math.max(0, record[key] + delta);
			}
		}
		this.records.set(id, next);
	}

	private requireRecord(id: string): AdminBroadcastRecord {
		const record = this.records.get(id);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
				message: `Broadcast "${id}" not found`,
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
