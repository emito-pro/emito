import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type {
	ApiPage,
	ScheduledSendCreate,
	ScheduledSendFilters,
	ScheduledSendRecord,
} from "../admin-types";
import type { ScheduledSendRepository } from "../scheduled-send-repository";
import { sliceToApiPage } from "./admin-cursor-helpers";
import { nextId } from "./admin-ids";

const TERMINAL_STATUSES = new Set(["complete", "cancelled"]);

/**
 * In-memory {@link ScheduledSendRepository} for unit tests.
 *
 * `list` pages newest-first by `createdAt`; `dueBy` returns `pending` jobs due at/before a
 * time, oldest-first. `cancel`/`reschedule` enforce the same lifecycle guards as the Drizzle
 * impl: cancelling a terminal job or rescheduling a non-pending job throws `RESOURCE_CONFLICT`.
 */
export class InMemoryScheduledSendRepository implements ScheduledSendRepository {
	private readonly records = new Map<string, ScheduledSendRecord>();

	async list(opts: {
		cursor?: string | null;
		limit: number;
		filters?: ScheduledSendFilters;
	}): Promise<ApiPage<ScheduledSendRecord>> {
		const f = opts.filters;
		const filtered = [...this.records.values()].filter((r) => {
			if (f?.status !== undefined && f.status.length > 0 && !f.status.includes(r.status)) {
				return false;
			}
			if (f?.from !== undefined && r.scheduledFor.getTime() < f.from.getTime()) return false;
			if (f?.to !== undefined && r.scheduledFor.getTime() > f.to.getTime()) return false;
			return true;
		});

		filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		return sliceToApiPage(filtered, (r) => r.createdAt, opts.cursor, opts.limit);
	}

	async findById(id: string): Promise<ScheduledSendRecord | null> {
		return this.records.get(id) ?? null;
	}

	async create(input: ScheduledSendCreate): Promise<ScheduledSendRecord> {
		const now = new Date();
		const record: ScheduledSendRecord = {
			id: nextId("sch"),
			kind: input.kind,
			eventKey: input.eventKey,
			payload: input.payload ?? {},
			recipients: input.recipients ?? {},
			scheduledFor: input.scheduledFor,
			timezone: input.timezone,
			status: "pending",
			createdByUserId: input.createdByUserId,
			cancelledAt: null,
			cancelledByUserId: null,
			createdAt: now,
			updatedAt: now,
		};
		this.records.set(record.id, record);
		return record;
	}

	async cancel(id: string, userId: string): Promise<ScheduledSendRecord> {
		const record = this.requireRecord(id);
		if (TERMINAL_STATUSES.has(record.status)) {
			throw this.conflict(id, record.status, "cancel");
		}
		const updated: ScheduledSendRecord = {
			...record,
			status: "cancelled",
			cancelledAt: new Date(),
			cancelledByUserId: userId,
			updatedAt: new Date(),
		};
		this.records.set(id, updated);
		return updated;
	}

	async reschedule(id: string, when: Date, timezone: string): Promise<ScheduledSendRecord> {
		const record = this.requireRecord(id);
		if (record.status !== "pending") {
			throw this.conflict(id, record.status, "reschedule");
		}
		const updated: ScheduledSendRecord = {
			...record,
			scheduledFor: when,
			timezone,
			updatedAt: new Date(),
		};
		this.records.set(id, updated);
		return updated;
	}

	async dueBy(at: Date, limit: number): Promise<readonly ScheduledSendRecord[]> {
		return [...this.records.values()]
			.filter((r) => r.status === "pending" && r.scheduledFor.getTime() <= at.getTime())
			.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
			.slice(0, Math.max(0, limit));
	}

	private conflict(id: string, status: string, op: string): EmitoError {
		return new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
			message: `Cannot ${op} scheduled send "${id}" in status "${status}"`,
			isRetryable: false,
			context: { id, status, op },
		});
	}

	private requireRecord(id: string): ScheduledSendRecord {
		const record = this.records.get(id);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
				message: `Scheduled send "${id}" not found`,
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
