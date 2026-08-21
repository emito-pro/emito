import type {
	ApiPage,
	AuditLogEntry,
	AuditLogFilters,
	AuditLogRecord,
	RepositoryTx,
} from "../admin-types";
import type { AuditLogRepository } from "../audit-log-repository";
import { sliceToApiPage } from "./admin-cursor-helpers";
import { nextId } from "./admin-ids";

/**
 * In-memory {@link AuditLogRepository} for unit tests.
 *
 * Records live in a Map keyed by id. `create` ignores the optional transaction handle (there
 * is no transaction in-memory). `list` filters in-memory and pages newest-first by `createdAt`,
 * matching the Drizzle implementation's contract (including `total` accuracy and cursor edge).
 */
export class InMemoryAuditLogRepository implements AuditLogRepository {
	private readonly records = new Map<string, AuditLogRecord>();

	async create(entry: AuditLogEntry, _tx?: RepositoryTx): Promise<AuditLogRecord> {
		const record: AuditLogRecord = {
			id: nextId("aud"),
			actorUserId: entry.actorUserId,
			actorKind: entry.actorKind,
			action: entry.action,
			resourceType: entry.resourceType,
			resourceId: entry.resourceId ?? null,
			severity: entry.severity,
			beforeState: entry.beforeState ?? null,
			afterState: entry.afterState ?? null,
			requestId: entry.requestId,
			ip: entry.ip,
			userAgent: entry.userAgent ?? null,
			apiKeyId: entry.apiKeyId ?? null,
			metadata: entry.metadata ?? {},
			createdAt: new Date(),
		};
		this.records.set(record.id, record);
		return record;
	}

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: AuditLogFilters;
	}): Promise<ApiPage<AuditLogRecord>> {
		const f = opts.filters;
		const filtered = [...this.records.values()].filter((r) => {
			if (f?.actor !== undefined && !r.actorUserId.toLowerCase().includes(f.actor.toLowerCase())) {
				return false;
			}
			if (f?.resourceType !== undefined && r.resourceType !== f.resourceType) return false;
			if (f?.resourceId !== undefined && r.resourceId !== f.resourceId) return false;
			if (f?.severity !== undefined && r.severity !== f.severity) return false;
			if (f?.action !== undefined && r.action !== f.action) return false;
			if (f?.from !== undefined && r.createdAt.getTime() < f.from.getTime()) return false;
			if (f?.to !== undefined && r.createdAt.getTime() > f.to.getTime()) return false;
			return true;
		});

		filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		return sliceToApiPage(filtered, (r) => r.createdAt, opts.cursor, opts.limit);
	}

	async findById(id: string): Promise<AuditLogRecord | null> {
		return this.records.get(id) ?? null;
	}

	/** Test helper: drop all records. */
	clear(): void {
		this.records.clear();
	}
}
