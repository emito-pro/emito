import type { ApiKeyCreate, ApiKeyRecord, ApiPage } from "./admin-types";

/**
 * Admin-issued API keys for programmatic access.
 *
 * The cleartext key is never stored — callers pass a pre-computed `keyHash` (bcrypt) and
 * `keyPrefix`. {@link findByPrefix} resolves the single *active* (non-revoked) key for a
 * prefix used during auth. {@link rotate} revokes-and-replaces the hash atomically, and
 * {@link revoke} is the soft-delete (the row is retained for audit but stops authenticating).
 */
export interface ApiKeyRepository {
	/**
	 * Page over API keys newest-first. Revoked keys are excluded unless `includeRevoked`.
	 *
	 * @throws EmitoError CURSOR_INVALID when the cursor cannot be decoded.
	 */
	list(opts: {
		cursor?: string | null;
		limit: number;
		includeRevoked?: boolean;
	}): Promise<ApiPage<ApiKeyRecord>>;

	/** Fetch a single key by id, or null when absent. */
	findById(id: string): Promise<ApiKeyRecord | null>;

	/** Resolve the single active (non-revoked) key for a prefix, or null when none. */
	findByPrefix(prefix: string): Promise<ApiKeyRecord | null>;

	/**
	 * Create an API key. `keyHash` and `keyPrefix` are required and computed by the caller.
	 *
	 * @throws EmitoError RESOURCE_CONFLICT when an active key already uses the same prefix.
	 */
	create(input: ApiKeyCreate): Promise<ApiKeyRecord>;

	/** Stamp `lastUsedAt = at`. No-op when the key does not exist (best-effort telemetry). */
	touchUsage(id: string, at: Date): Promise<void>;

	/**
	 * Replace the key's hash/prefix in place, keeping the same row id.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 * @throws EmitoError RESOURCE_CONFLICT when an active key already uses `newPrefix`.
	 */
	rotate(id: string, newHash: string, newPrefix: string): Promise<ApiKeyRecord>;

	/**
	 * Soft-delete the key by stamping `revokedAt = at`. Idempotent — re-revoking is a no-op.
	 *
	 * @throws EmitoError RESOURCE_NOT_FOUND when the id is unknown.
	 */
	revoke(id: string, at: Date): Promise<void>;
}
