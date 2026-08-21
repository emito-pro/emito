import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { EmitoErrorCode } from "@emito/types";
import { isBrowser } from "../transport/websocket.js";

export interface HttpClientConfig {
	endpoint: string;
	/** Static JWT auth token. Provide this OR `getToken`. */
	token?: string;
	/** Async token provider; called per-request so a short-lived token can refresh without re-instantiating the client. */
	getToken?: () => Promise<string>;
}

interface RequestOptions {
	method: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	body?: unknown;
	query?: Record<string, string | number | undefined>;
}

/**
 * Lightweight HTTP client for Emito subscriber API calls.
 * Adds Authorization header and handles JSON serialization/error mapping.
 */
export class HttpClient {
	private readonly endpoint: string;
	private readonly token: string | undefined;
	private readonly getToken: (() => Promise<string>) | undefined;

	constructor(config: HttpClientConfig) {
		this.endpoint = config.endpoint.replace(/\/$/, "");
		this.token = config.token;
		this.getToken = config.getToken;
	}

	/**
	 * Resolve the current token. Only awaits when a `getToken` callback is
	 * configured — the static-token path stays fully synchronous so `fetch()`
	 * is invoked in the same tick as before (existing tests rely on this).
	 */
	private async currentToken(): Promise<string> {
		return this.getToken ? await this.getToken() : (this.token ?? "");
	}

	async request<T>(options: RequestOptions): Promise<T> {
		const url = this.buildUrl(options.path, options.query);
		const token = this.getToken ? await this.currentToken() : (this.token ?? "");

		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		};

		let fetchBody: string | undefined;
		if (options.body !== undefined) {
			headers["Content-Type"] = "application/json";
			fetchBody = JSON.stringify(options.body);
		}

		let response: Response;
		try {
			response = await fetch(url, {
				method: options.method,
				headers,
				body: fetchBody,
			});
		} catch (err) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.TRANSPORT_CONNECTION_FAILED,
				message: err instanceof Error ? err.message : "Network request failed",
				statusCode: 0,
				isRetryable: true,
				context: { url, method: options.method },
			});
		}

		if (!response.ok) {
			await this.handleErrorResponse(response, url, options.method);
		}

		const json = (await response.json()) as { data: T };
		return json.data;
	}

	private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
		// `new URL()` requires an absolute base. In a browser, resolve a relative
		// `endpoint` (e.g. "/emito", the natural choice for a same-origin SSR app)
		// against the page's own origin — mirrors the same-origin assumption the
		// WS transport already makes for cookie-mode auth. Outside a browser
		// (Node/RN) there's no page origin, so `endpoint` must stay absolute, as
		// before.
		const base = isBrowser()
			? new URL(this.endpoint, window.location.origin).toString()
			: this.endpoint;
		const url = new URL(`${base}${path}`);
		if (query) {
			for (const [key, value] of Object.entries(query)) {
				if (value !== undefined) {
					url.searchParams.set(key, String(value));
				}
			}
		}
		return url.toString();
	}

	private async handleErrorResponse(
		response: Response,
		url: string,
		method: string,
	): Promise<never> {
		let errorBody: { error?: { code?: string; message?: string } } | undefined;
		try {
			errorBody = (await response.json()) as { error?: { code?: string; message?: string } };
		} catch {
			// Response body is not JSON
		}

		const code = this.mapStatusToErrorCode(response.status, errorBody?.error?.code);
		const message = errorBody?.error?.message ?? `HTTP ${response.status}`;

		throw new EmitoError({
			code,
			message,
			statusCode: response.status,
			isRetryable: response.status >= 500 || response.status === 429,
			context: { url, method, responseStatus: response.status },
		});
	}

	private mapStatusToErrorCode(status: number, serverCode?: string): EmitoErrorCode {
		// If the server returned a known error code, use it
		if (serverCode && serverCode in EMITO_ERROR_CODE) {
			return serverCode as EmitoErrorCode;
		}

		switch (status) {
			case 400:
				return EMITO_ERROR_CODE.VALIDATION_ERROR;
			case 401:
				return EMITO_ERROR_CODE.AUTH_INVALID_TOKEN;
			case 403:
				return EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE;
			case 404:
				return EMITO_ERROR_CODE.RESOURCE_NOT_FOUND;
			case 409:
				return EMITO_ERROR_CODE.RESOURCE_CONFLICT;
			case 429:
				return EMITO_ERROR_CODE.RATE_LIMITED;
			default:
				return EMITO_ERROR_CODE.INTERNAL_ERROR;
		}
	}
}
