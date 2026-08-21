/**
 * The HTTP API version this SDK speaks.
 *
 * Kept in lockstep with `API_VERSION` in `@emito/server`. The client appends it
 * to the configured `endpoint` itself, so callers configure *where* Emito is
 * mounted and never have to restate *which* version they are on — upgrading the
 * package is what moves you to a new version.
 */
export const API_VERSION = "v1";

/**
 * Resolve the versioned API base from a caller-supplied mount URL.
 *
 * `endpoint` is the mount path (`https://myapp.com/emito`) — the same value the
 * host passes as `prefix` to `createEmitoServer`. Any trailing slash is dropped
 * so the result never contains a double separator.
 */
export function resolveApiBase(endpoint: string): string {
	return `${endpoint.replace(/\/$/, "")}/${API_VERSION}`;
}
