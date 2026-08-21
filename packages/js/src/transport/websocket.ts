import type { NotificationEvent } from "@emito/types";
import type {
	TransportAdapter,
	TransportState,
	WebSocketAdapterOptions,
	WsAuthMode,
} from "../types.js";

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000; // 1.5x server's 30s interval
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface WsMessage {
	type: string;
	id?: string;
	data?: NotificationEvent;
}

/**
 * Node.js `ws` package accepts an options object with headers as the second
 * constructor argument. The browser WebSocket API expects (url, protocols?).
 * We define this locally to avoid a runtime dependency on `@types/ws`.
 */
interface WsConstructorOptions {
	headers?: Record<string, string>;
}

/** WebSocket constructor signature that accepts Node `ws` options */
type WsConstructor = new (url: string, opts?: WsConstructorOptions) => WebSocket;

/** Detect browser runtime — cookies are sent automatically on WS upgrade */
export function isBrowser(): boolean {
	return typeof globalThis.window !== "undefined";
}

/**
 * WebSocket transport adapter.
 * Connects to `{endpoint}/ws`, handles heartbeat detection and auto-reconnect.
 *
 * Auth strategy (token NEVER appears in the URL):
 * - **Browser (cookie mode):** `new WebSocket(url)` — session cookies are sent
 *   automatically on the HTTP upgrade request.
 * - **Node/RN (header mode):** `new WebSocket(url, { headers: { Authorization } })`
 *   — the `ws` package supports custom headers on the upgrade request.
 * - `wsAuth` option overrides auto-detection.
 */
export class WebSocketAdapter implements TransportAdapter {
	readonly type = "ws" as const;
	private _state: TransportState = "disconnected";
	private ws: WebSocket | null = null;
	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempt = 0;
	private intentionalClose = false;
	private lastEventId: string | undefined;

	private messageHandler: ((event: NotificationEvent, streamId?: string) => void) | null = null;
	private errorHandler: ((error: Error) => void) | null = null;
	private reconnectHandler: (() => void) | null = null;

	private readonly endpoint: string;
	private readonly token: string | undefined;
	private readonly getToken: (() => Promise<string>) | undefined;
	private readonly heartbeatTimeoutMs: number;
	private readonly wsAuth: WsAuthMode;
	private readonly wsEndpoint: string | undefined;

	constructor(options: WebSocketAdapterOptions) {
		this.endpoint = options.endpoint;
		this.token = options.token;
		this.getToken = options.getToken;
		this.lastEventId = options.lastEventId;
		this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
		this.wsAuth = options.wsAuth ?? (isBrowser() ? "cookie" : "header");
		this.wsEndpoint = options.wsEndpoint;
	}

	/**
	 * Resolve the current token for header-mode auth.
	 * NOTE: only called when a getToken callback is present — the static-token
	 * path stays fully synchronous (see doConnect) so WebSocket construction is
	 * not deferred by a microtask when no async token provider is configured.
	 */
	private async currentToken(): Promise<string> {
		return this.getToken ? await this.getToken() : (this.token ?? "");
	}

	get state(): TransportState {
		return this._state;
	}

	connect(): Promise<void> {
		if (this._state === "connected" || this._state === "connecting") {
			return Promise.resolve();
		}

		this.intentionalClose = false;
		return this.doConnect();
	}

	disconnect(): void {
		this.intentionalClose = true;
		this.cleanup();
		this._state = "disconnected";
	}

	onMessage(handler: (event: NotificationEvent, streamId?: string) => void): void {
		this.messageHandler = handler;
	}

	onError(handler: (error: Error) => void): void {
		this.errorHandler = handler;
	}

	onReconnect(handler: () => void): void {
		this.reconnectHandler = handler;
	}

	/** Update lastEventId from outside (e.g., transport manager tracking) */
	setLastEventId(id: string): void {
		this.lastEventId = id;
	}

	private doConnect(): Promise<void> {
		// Header mode with an async token provider needs the token resolved before
		// construction; the static-token path (and cookie mode) stays synchronous
		// so we don't defer WebSocket construction by a microtask unnecessarily.
		if (this.wsAuth === "header" && this.getToken) {
			return this.currentToken().then((token) => this.doConnectWithToken(token));
		}
		return this.doConnectWithToken(this.token ?? "");
	}

	private doConnectWithToken(token: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this._state = "connecting";

			const url = this.buildUrl();
			let settled = false;

			try {
				if (this.wsAuth === "header") {
					// Node/RN: ws package accepts a second arg with headers
					const Ws = WebSocket as unknown as WsConstructor;
					this.ws = new Ws(url, {
						headers: { Authorization: `Bearer ${token}` },
					});
				} else {
					// Browser: cookies are sent automatically on upgrade
					this.ws = new WebSocket(url);
				}
			} catch (err) {
				this._state = "disconnected";
				const error = err instanceof Error ? err : new Error(String(err));
				reject(error);
				return;
			}

			this.ws.onopen = () => {
				if (!settled) {
					settled = true;
					this._state = "connected";
					this.reconnectAttempt = 0;
					this.resetHeartbeatTimer();
					resolve();
				}
			};

			this.ws.onmessage = (event: MessageEvent) => {
				this.resetHeartbeatTimer();
				this.handleMessage(event);
			};

			this.ws.onerror = () => {
				const error = new Error("WebSocket connection error");
				this.errorHandler?.(error);
				if (!settled) {
					settled = true;
					this._state = "disconnected";
					reject(error);
				}
			};

			this.ws.onclose = () => {
				this._state = "disconnected";
				this.clearHeartbeatTimer();

				if (!settled) {
					settled = true;
					reject(new Error("WebSocket closed before open"));
					return;
				}

				if (!this.intentionalClose) {
					this.scheduleReconnect();
				}
			};
		});
	}

	private buildUrl(): string {
		let wsUrl: string;
		if (this.wsEndpoint) {
			wsUrl = this.wsEndpoint.replace(/\/$/, "");
		} else {
			const base = this.endpoint.replace(/\/$/, "");
			// Use wss: for https:, ws: for http:
			wsUrl = `${base.replace(/^http/, "ws")}/ws`;
		}
		const params = new URLSearchParams();
		if (this.lastEventId) {
			params.set("lastEventId", this.lastEventId);
		}
		const qs = params.toString();
		return qs ? `${wsUrl}?${qs}` : wsUrl;
	}

	private handleMessage(event: MessageEvent): void {
		let parsed: WsMessage;
		try {
			parsed = JSON.parse(String(event.data)) as WsMessage;
		} catch {
			return; // Malformed JSON
		}

		if (parsed.type === "notification" && parsed.data) {
			if (parsed.id) {
				this.lastEventId = parsed.id;
			}
			// Restore Date from JSON
			if (typeof parsed.data.timestamp === "string") {
				parsed.data.timestamp = new Date(parsed.data.timestamp);
			}
			this.messageHandler?.(parsed.data, parsed.id);
		}
		// heartbeat type is handled implicitly by resetHeartbeatTimer on any message
	}

	private resetHeartbeatTimer(): void {
		this.clearHeartbeatTimer();
		this.heartbeatTimer = setTimeout(() => {
			// No message received within timeout — connection is stale
			this.errorHandler?.(new Error("WebSocket heartbeat timeout"));
			this.ws?.close();
		}, this.heartbeatTimeoutMs);
	}

	private clearHeartbeatTimer(): void {
		if (this.heartbeatTimer) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return;

		const delay = Math.min(
			RECONNECT_BASE_MS * 2 ** this.reconnectAttempt + Math.random() * 1000,
			RECONNECT_MAX_MS,
		);
		this.reconnectAttempt++;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.doConnect()
				.then(() => {
					this.reconnectHandler?.();
				})
				.catch(() => {
					// Reconnect failed — will be retried via onclose
				});
		}, delay);
	}

	private cleanup(): void {
		this.clearHeartbeatTimer();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.onopen = null;
			this.ws.onmessage = null;
			this.ws.onerror = null;
			this.ws.onclose = null;
			try {
				this.ws.close();
			} catch {
				// Already closed
			}
			this.ws = null;
		}
	}
}
