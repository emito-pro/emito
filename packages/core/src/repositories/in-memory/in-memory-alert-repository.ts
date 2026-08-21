import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { AlertCreate, AlertFilters, AlertPatch, AlertRecord, ApiPage } from "../admin-types";
import type { AlertRepository } from "../alert-repository";
import { sliceToApiPage } from "./admin-cursor-helpers";
import { nextId } from "./admin-ids";

/**
 * In-memory {@link AlertRepository} for unit tests.
 *
 * Mirrors the Drizzle contract: optimistic concurrency via `version` (bumped on every
 * update, checked against `expectedVersion`), `RESOURCE_NOT_FOUND` on unknown ids, and
 * `RESOURCE_CONFLICT` on a stale `expectedVersion`. `markTriggered` does not bump `version`.
 */
export class InMemoryAlertRepository implements AlertRepository {
	private readonly records = new Map<string, AlertRecord>();

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AlertFilters;
	}): Promise<ApiPage<AlertRecord>> {
		const f = opts.filters;
		const filtered = [...this.records.values()].filter((r) => {
			if (f?.enabled !== undefined && r.enabled !== f.enabled) return false;
			if (f?.severity !== undefined && f.severity.length > 0 && !f.severity.includes(r.severity)) {
				return false;
			}
			if (f?.metric !== undefined && f.metric.length > 0 && !f.metric.includes(r.metric)) {
				return false;
			}
			return true;
		});

		filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		return sliceToApiPage(filtered, (r) => r.createdAt, opts.cursor, opts.limit);
	}

	async findById(id: string): Promise<AlertRecord | null> {
		return this.records.get(id) ?? null;
	}

	async create(input: AlertCreate): Promise<AlertRecord> {
		const now = new Date();
		const record: AlertRecord = {
			id: nextId("alr"),
			name: input.name,
			metric: input.metric,
			condition: input.condition,
			severity: input.severity,
			notify: input.notify,
			escalation: input.escalation ?? null,
			maintenance: input.maintenance ?? null,
			enabled: input.enabled ?? true,
			lastTriggeredAt: null,
			version: 1,
			createdAt: now,
			updatedAt: now,
		};
		this.records.set(record.id, record);
		return record;
	}

	async update(
		id: string,
		patch: AlertPatch,
		opts?: { expectedVersion?: number },
	): Promise<AlertRecord> {
		const record = this.requireRecord(id);
		if (opts?.expectedVersion !== undefined && opts.expectedVersion !== record.version) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
				message: `Alert "${id}" version mismatch: expected ${opts.expectedVersion}, found ${record.version}`,
				isRetryable: false,
				context: { id, expectedVersion: opts.expectedVersion, actualVersion: record.version },
			});
		}

		const updated: AlertRecord = {
			...record,
			name: patch.name ?? record.name,
			metric: patch.metric ?? record.metric,
			condition: patch.condition ?? record.condition,
			severity: patch.severity ?? record.severity,
			notify: patch.notify ?? record.notify,
			escalation: patch.escalation === undefined ? record.escalation : patch.escalation,
			maintenance: patch.maintenance === undefined ? record.maintenance : patch.maintenance,
			enabled: patch.enabled ?? record.enabled,
			version: record.version + 1,
			updatedAt: new Date(),
		};
		this.records.set(id, updated);
		return updated;
	}

	async delete(id: string): Promise<void> {
		this.requireRecord(id);
		this.records.delete(id);
	}

	async markTriggered(id: string, at: Date): Promise<void> {
		const record = this.requireRecord(id);
		this.records.set(id, { ...record, lastTriggeredAt: at });
	}

	private requireRecord(id: string): AlertRecord {
		const record = this.records.get(id);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
				message: `Alert "${id}" not found`,
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
