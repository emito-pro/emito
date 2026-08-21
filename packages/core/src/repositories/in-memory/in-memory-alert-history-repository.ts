import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type {
	AlertHistoryCreate,
	AlertHistoryFilters,
	AlertHistoryRecord,
	ApiPage,
} from "../admin-types";
import type { AlertHistoryRepository } from "../alert-history-repository";
import { sliceToApiPage } from "./admin-cursor-helpers";
import { nextId } from "./admin-ids";

/**
 * In-memory {@link AlertHistoryRepository} for unit tests.
 *
 * Records page newest-first by `triggeredAt`. `acknowledged` filtering keys off whether
 * `acknowledgedAt` is set. `activeAlerts` returns the un-resolved firings, newest-first.
 */
export class InMemoryAlertHistoryRepository implements AlertHistoryRepository {
	private readonly records = new Map<string, AlertHistoryRecord>();

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AlertHistoryFilters;
	}): Promise<ApiPage<AlertHistoryRecord>> {
		const f = opts.filters;
		const filtered = [...this.records.values()].filter((r) => {
			if (f?.alertId !== undefined && r.alertId !== f.alertId) return false;
			if (f?.acknowledged !== undefined) {
				const isAck = r.acknowledgedAt !== null;
				if (isAck !== f.acknowledged) return false;
			}
			if (f?.from !== undefined && r.triggeredAt.getTime() < f.from.getTime()) return false;
			if (f?.to !== undefined && r.triggeredAt.getTime() > f.to.getTime()) return false;
			return true;
		});

		filtered.sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());
		return sliceToApiPage(filtered, (r) => r.triggeredAt, opts.cursor, opts.limit);
	}

	async findById(id: string): Promise<AlertHistoryRecord | null> {
		return this.records.get(id) ?? null;
	}

	async create(entry: AlertHistoryCreate): Promise<AlertHistoryRecord> {
		const record: AlertHistoryRecord = {
			id: nextId("ahi"),
			alertId: entry.alertId,
			triggeredAt: entry.triggeredAt ?? new Date(),
			resolvedAt: null,
			triggeredValue: entry.triggeredValue ?? null,
			acknowledgedAt: null,
			acknowledgedByUserId: null,
			notes: null,
		};
		this.records.set(record.id, record);
		return record;
	}

	async acknowledge(id: string, userId: string, notes?: string): Promise<AlertHistoryRecord> {
		const record = this.requireRecord(id);
		const updated: AlertHistoryRecord = {
			...record,
			acknowledgedAt: new Date(),
			acknowledgedByUserId: userId,
			notes: notes ?? null,
		};
		this.records.set(id, updated);
		return updated;
	}

	async resolve(id: string, at: Date): Promise<AlertHistoryRecord> {
		const record = this.requireRecord(id);
		const updated: AlertHistoryRecord = { ...record, resolvedAt: at };
		this.records.set(id, updated);
		return updated;
	}

	async activeAlerts(): Promise<readonly AlertHistoryRecord[]> {
		return [...this.records.values()]
			.filter((r) => r.resolvedAt === null)
			.sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());
	}

	private requireRecord(id: string): AlertHistoryRecord {
		const record = this.records.get(id);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
				message: `Alert history "${id}" not found`,
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
