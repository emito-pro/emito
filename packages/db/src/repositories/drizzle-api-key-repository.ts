import type {
	ApiKeyCreate,
	ApiKeyRecord,
	ApiKeyRepository,
	ApiKeyScope,
	ApiPage,
} from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { emito_api_keys } from "../schema/api-keys";
import { buildAdminPage, decodeAdminCursorDate, normalizeAdminLimit } from "./admin-pagination";
import type { DrizzleDb } from "./db-type";

/**
 * Drizzle implementation of {@link ApiKeyRepository}.
 *
 * The partial unique index (`keyPrefix WHERE revoked_at IS NULL`) guarantees at most one active
 * key per prefix; a colliding `create`/`rotate` is re-mapped from SQLSTATE 23505 to
 * `RESOURCE_CONFLICT`. `findByPrefix` returns only the active key. `touchUsage` is best-effort
 * (no error when the id is unknown). `revoke` is idempotent — re-revoking is a no-op.
 */
export class DrizzleApiKeyRepository implements ApiKeyRepository {
	constructor(private readonly db: DrizzleDb) {}

	async list(opts: {
		cursor?: string | null;
		limit: number;
		includeRevoked?: boolean;
	}): Promise<ApiPage<ApiKeyRecord>> {
		const limit = normalizeAdminLimit(opts.limit);
		const cursorDate = decodeAdminCursorDate(opts.cursor);
		const where = this.buildWhere(opts.includeRevoked ?? false, cursorDate);

		const rows = await this.db
			.select()
			.from(emito_api_keys)
			.where(where)
			.orderBy(desc(emito_api_keys.createdAt))
			.limit(limit + 1);

		const total = await this.count(opts.includeRevoked ?? false);
		return buildAdminPage(
			rows.map((r) => this.mapRow(r)),
			limit,
			total,
			(r) => r.createdAt,
		);
	}

	async findById(id: string): Promise<ApiKeyRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_api_keys)
			.where(eq(emito_api_keys.id, id))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async findByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
		const [row] = await this.db
			.select()
			.from(emito_api_keys)
			.where(and(eq(emito_api_keys.keyPrefix, prefix), isNull(emito_api_keys.revokedAt)))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async create(input: ApiKeyCreate): Promise<ApiKeyRecord> {
		try {
			const [row] = await this.db
				.insert(emito_api_keys)
				.values({
					name: input.name,
					keyHash: input.keyHash,
					keyPrefix: input.keyPrefix,
					scope: input.scope,
					createdByUserId: input.createdByUserId,
				})
				.returning();
			return this.mapRow(row);
		} catch (err) {
			throw this.mapConflict(err, input.keyPrefix);
		}
	}

	async touchUsage(id: string, at: Date): Promise<void> {
		await this.db.update(emito_api_keys).set({ lastUsedAt: at }).where(eq(emito_api_keys.id, id));
	}

	async rotate(id: string, newHash: string, newPrefix: string): Promise<ApiKeyRecord> {
		try {
			const [row] = await this.db
				.update(emito_api_keys)
				.set({ keyHash: newHash, keyPrefix: newPrefix })
				.where(eq(emito_api_keys.id, id))
				.returning();
			if (!row) throw this.notFound(id);
			return this.mapRow(row);
		} catch (err) {
			if (err instanceof EmitoError) throw err;
			throw this.mapConflict(err, newPrefix);
		}
	}

	async revoke(id: string, at: Date): Promise<void> {
		const [row] = await this.db
			.update(emito_api_keys)
			.set({ revokedAt: at })
			.where(and(eq(emito_api_keys.id, id), isNull(emito_api_keys.revokedAt)))
			.returning({ id: emito_api_keys.id });
		if (row) return;
		// No active row updated: either already revoked (no-op) or unknown id (error).
		const existing = await this.findById(id);
		if (!existing) throw this.notFound(id);
	}

	private mapConflict(err: unknown, prefix: string): EmitoError {
		if (isUniqueViolation(err)) {
			return new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
				message: `An active API key already uses prefix "${prefix}"`,
				isRetryable: false,
				context: { prefix },
				cause: err instanceof Error ? err : undefined,
			});
		}
		return err instanceof Error
			? EmitoError.fromUnknown(err, { code: EMITO_ERROR_CODE.INTERNAL_ERROR })
			: new EmitoError({
					code: EMITO_ERROR_CODE.INTERNAL_ERROR,
					message: "Unknown error inserting API key",
					context: { prefix },
				});
	}

	private notFound(id: string): EmitoError {
		return new EmitoError({
			code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
			message: `API key "${id}" not found`,
			isRetryable: false,
			context: { id },
		});
	}

	private async count(includeRevoked: boolean): Promise<number> {
		const where = this.buildWhere(includeRevoked, undefined);
		const [row] = await this.db
			.select({ value: sql<number>`count(*)::int` })
			.from(emito_api_keys)
			.where(where);
		return row?.value ?? 0;
	}

	private buildWhere(includeRevoked: boolean, cursorDate: Date | undefined) {
		const conditions = [];
		if (!includeRevoked) {
			conditions.push(isNull(emito_api_keys.revokedAt));
		}
		if (cursorDate !== undefined) {
			conditions.push(sql`${emito_api_keys.createdAt} < ${cursorDate}`);
		}
		return conditions.length > 0 ? and(...conditions) : undefined;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): ApiKeyRecord {
		return {
			id: row.id,
			name: row.name,
			keyHash: row.keyHash,
			keyPrefix: row.keyPrefix,
			scope: row.scope as ApiKeyScope,
			createdByUserId: row.createdByUserId,
			lastUsedAt: row.lastUsedAt ?? null,
			createdAt: row.createdAt,
			revokedAt: row.revokedAt ?? null,
		};
	}
}

/** Narrow an unknown thrown value to a Postgres unique-violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
	return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}
