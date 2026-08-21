import { EMITO_ERROR_CODE } from "@emito/types";
import { deliveryError } from "./errors";

/**
 * Default per-request ceiling for HTTP-backed providers. A provider endpoint
 * that accepts a connection and then stalls would otherwise hold a delivery
 * worker open indefinitely.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchOptions {
	/** Injectable fetch, primarily for tests. Falls back to the global. */
	fetchFn?: typeof globalThis.fetch;
	timeoutMs?: number;
}

/**
 * Resolves the fetch implementation to use.
 *
 * The global is looked up lazily inside the returned closure rather than
 * captured: tests stub `globalThis.fetch` after the provider module has loaded,
 * and a bare reference to the native fetch is not callable when detached from
 * its receiver.
 */
export function resolveFetch(fetchFn?: typeof globalThis.fetch): typeof globalThis.fetch {
	if (fetchFn) return fetchFn;
	return (input, init) => globalThis.fetch(input, init);
}

export interface ProviderFetchOptions extends FetchOptions {
	/** Human-facing provider name used in timeout messages, e.g. "Telegram". */
	displayName: string;
	context?: Record<string, unknown>;
}

function isTimeoutError(err: unknown): boolean {
	return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * Performs a request with a timeout and maps an expiring deadline to
 * `PROVIDER_TIMEOUT`. Every other failure is left to propagate so the caller —
 * normally the `defineProvider` wrapper — classifies it.
 */
export async function providerFetch(
	input: string,
	init: RequestInit,
	options: ProviderFetchOptions,
): Promise<Response> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const fetchFn = resolveFetch(options.fetchFn);

	try {
		return await fetchFn(input, {
			...init,
			signal: init.signal ?? AbortSignal.timeout(timeoutMs),
		});
	} catch (err: unknown) {
		if (isTimeoutError(err)) {
			throw deliveryError(
				EMITO_ERROR_CODE.PROVIDER_TIMEOUT,
				`${options.displayName} request timed out after ${timeoutMs}ms`,
				{ context: options.context, cause: err instanceof Error ? err : undefined },
			);
		}
		throw err;
	}
}

/** Reads a response body for use in an error message, never throwing on a broken stream. */
export async function readErrorBody(response: Response): Promise<string> {
	return response.text().catch(() => "unknown");
}
