import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ApiKeyCreate, ApiKeyRecord, ApiPage } from "../admin-types";
import type { ApiKeyRepository } from "../api-key-repository";
import { sliceToApiPage } from "./admin-cursor-helpers";
import { nextId } from "./admin-ids";

/**
 * In-memory {@link ApiKeyRepository} for unit tests.
 *
 * Mirrors the partial-unique-index semantics: at most one *active* (non-revoked) key per
 * prefix. `create` and `rotate` throw `RESOURCE_CONFLICT` when an active key already uses the
 * target prefix. `findByPrefix` returns only the active key. `revoke` is idempotent.
 */
export class InMemoryApiKeyRepository implements ApiKeyRepository {
	private readonly records = new Map<string, ApiKeyRecord>();

	async list(opts: {
		cursor?: string | null;
		limit: number;
		includeRevoked?: boolean;
	}): Promise<ApiPage<ApiKeyRecord>> {
		const filtered = [...this.records.values()].filter((r) => {
			if (!opts.includeRevoked && r.revokedAt !== null) return false;
			return true;
		});

		filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		return sliceToApiPage(filtered, (r) => r.createdAt, opts.cursor, opts.limit);
	}

	async findById(id: string): Promise<ApiKeyRecord | null> {
		return this.records.get(id) ?? null;
	}

	async findByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
		return (
			[...this.records.values()].find((r) => r.keyPrefix === prefix && r.revokedAt === null) ?? null
		);
	}

	async create(input: ApiKeyCreate): Promise<ApiKeyRecord> {
		this.assertPrefixFree(input.keyPrefix);
		const record: ApiKeyRecord = {
			id: nextId("apk"),
			name: input.name,
			keyHash: input.keyHash,
			keyPrefix: input.keyPrefix,
			scope: input.scope,
			createdByUserId: input.createdByUserId,
			lastUsedAt: null,
			createdAt: new Date(),
			revokedAt: null,
		};
		this.records.set(record.id, record);
		return record;
	}

	async touchUsage(id: string, at: Date): Promise<void> {
		const record = this.records.get(id);
		if (!record) return;
		this.records.set(id, { ...record, lastUsedAt: at });
	}

	async rotate(id: string, newHash: string, newPrefix: string): Promise<ApiKeyRecord> {
		const record = this.requireRecord(id);
		this.assertPrefixFree(newPrefix, id);
		const updated: ApiKeyRecord = { ...record, keyHash: newHash, keyPrefix: newPrefix };
		this.records.set(id, updated);
		return updated;
	}

	async revoke(id: string, at: Date): Promise<void> {
		const record = this.requireRecord(id);
		if (record.revokedAt !== null) return;
		this.records.set(id, { ...record, revokedAt: at });
	}

	private assertPrefixFree(prefix: string, ignoreId?: string): void {
		const clash = [...this.records.values()].find(
			(r) => r.keyPrefix === prefix && r.revokedAt === null && r.id !== ignoreId,
		);
		if (clash) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
				message: `An active API key already uses prefix "${prefix}"`,
				isRetryable: false,
				context: { prefix },
			});
		}
	}

	private requireRecord(id: string): ApiKeyRecord {
		const record = this.records.get(id);
		if (!record) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
				message: `API key "${id}" not found`,
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
