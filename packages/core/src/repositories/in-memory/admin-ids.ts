/**
 * Monotonic, prefixed id generator for the in-memory admin repositories.
 *
 * `@emito/core` cannot depend on `@emito/db` (where the real uuidv7 `generateId` lives), so
 * the in-memory test doubles mint deterministic-ish ids of the same `{prefix}_{n}` shape.
 * The counter is process-global and padded so lexical and numeric order agree, which keeps
 * test assertions on id ordering stable. Real persistence ids come from `@emito/db`.
 */
let counter = 0;

/** Mint a unique `{prefix}_mem_{seq}` id. The sequence is global and strictly increasing. */
export function nextId(prefix: string): string {
	counter += 1;
	return `${prefix}_mem_${String(counter).padStart(9, "0")}`;
}
