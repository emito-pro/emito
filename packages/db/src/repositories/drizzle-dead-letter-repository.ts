import type {
	CreateDeadLetterData,
	CursorResult,
	DeadLetterAttempt,
	DeadLetterFilter,
	DeadLetterRecord,
	DeadLetterRepository,
} from "@emito/core";
import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { emito_dead_letters } from "../schema/dead-letters";
import type { DrizzleDb } from "./db-type";
import { decodeCursorDate, normalizeLimit, toCursorResult } from "./pagination";

/**
 * Safety cap on {@link DrizzleDeadLetterRepository.findAllForAdmin}.
 *
 * The admin DLQ list filters on the auto-classified `rootCause` (derived from
 * the attempt chain, not a stored column), so it cannot push that filter into SQL
 * and must classify + paginate in memory over the loaded set. The DLQ is an
 * operational queue an operator drains; this cap bounds a pathological backlog so
 * a single list request can never load an unbounded result set into memory.
 */
const ADMIN_LIST_CAP = 10_000;

export class DrizzleDeadLetterRepository implements DeadLetterRepository {
	constructor(private readonly db: DrizzleDb) {}

	async create(data: CreateDeadLetterData): Promise<DeadLetterRecord> {
		const [row] = await this.db
			.insert(emito_dead_letters)
			.values({
				notificationId: data.notificationId,
				subscriberId: data.subscriberId,
				eventType: data.eventType,
				channel: data.channel,
				attempts: data.attempts,
				payload: data.payload,
			})
			.returning();
		return this.mapRow(row);
	}

	async list(filter?: DeadLetterFilter): Promise<CursorResult<DeadLetterRecord>> {
		const limit = normalizeLimit(filter?.limit);
		const cursorDate = decodeCursorDate(filter?.cursor);

		const conditions = [];
		const resolved = filter?.resolved ?? false;
		if (!resolved) {
			conditions.push(isNull(emito_dead_letters.resolvedAt));
		}
		if (cursorDate) conditions.push(lt(emito_dead_letters.exhaustedAt, cursorDate));

		const rows = await this.db
			.select()
			.from(emito_dead_letters)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(desc(emito_dead_letters.exhaustedAt))
			.limit(limit + 1);

		return toCursorResult(
			rows.map((r) => this.mapRow(r)),
			limit,
			(r) => r.exhaustedAt.toISOString(),
		);
	}

	async findById(id: string): Promise<DeadLetterRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_dead_letters)
			.where(eq(emito_dead_letters.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async resolve(id: string, resolution: string): Promise<void> {
		await this.db
			.update(emito_dead_letters)
			.set({ resolvedAt: new Date(), resolution })
			.where(eq(emito_dead_letters.id, id));
	}

	async unresolve(id: string): Promise<void> {
		await this.db
			.update(emito_dead_letters)
			.set({ resolvedAt: null, resolution: null })
			.where(eq(emito_dead_letters.id, id));
	}

	async purgeResolved(): Promise<number> {
		const deleted = await this.db
			.delete(emito_dead_letters)
			.where(isNotNull(emito_dead_letters.resolvedAt))
			.returning({ id: emito_dead_letters.id });
		return deleted.length;
	}

	async findAllForAdmin(): Promise<DeadLetterRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_dead_letters)
			.orderBy(desc(emito_dead_letters.exhaustedAt))
			.limit(ADMIN_LIST_CAP);
		return rows.map((r) => this.mapRow(r));
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): DeadLetterRecord {
		return {
			id: row.id,
			notificationId: row.notificationId,
			subscriberId: row.subscriberId,
			eventType: row.eventType,
			channel: row.channel,
			attempts: reviveAttempts(row.attempts),
			payload: (row.payload as Record<string, unknown>) ?? {},
			exhaustedAt: row.exhaustedAt,
			resolvedAt: row.resolvedAt ?? undefined,
			resolution: row.resolution ?? undefined,
		};
	}
}

/**
 * Revive the JSONB-stored attempt chain into the typed {@link DeadLetterAttempt}
 * shape, restoring each entry's `timestamp` to a real `Date`.
 *
 * `DeadLetterAttempt.timestamp` is declared as a `Date`, but JSONB has no date
 * type — Postgres deserializes the stored ISO string back to a `string`. Consumers
 * (e.g. the dead-letter detail projection) call `timestamp.toISOString()`,
 * which throws on a raw string. So we coerce each `timestamp` back to a `Date` here,
 * at the repository boundary, keeping the in-memory record faithful to its type.
 * Malformed/absent attempt arrays degrade to an empty chain.
 *
 * @param raw - The raw JSONB value read from the `attempts` column.
 * @returns The typed attempt chain with `Date` timestamps.
 */
function reviveAttempts(raw: unknown): DeadLetterAttempt[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((entry) => {
		const a = entry as Record<string, unknown>;
		const ts = a.timestamp;
		return {
			provider: typeof a.provider === "string" ? a.provider : "",
			timestamp: ts instanceof Date ? ts : new Date(typeof ts === "string" ? ts : 0),
			errorCode: typeof a.errorCode === "string" ? a.errorCode : "",
			errorMessage: typeof a.errorMessage === "string" ? a.errorMessage : "",
		};
	});
}
