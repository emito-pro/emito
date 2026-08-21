import type { NotificationEvent } from "@emito/types";
import type { SSEAdapterOptions, TransportAdapter, TransportState } from "../types.js";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

/**
 * SSE transport adapter using fetch + ReadableStream.
 *
 * We use fetch instead of the browser EventSource API because EventSource
 * does not support custom headers (Authorization). The trade-off is that
 * we handle reconnection ourselves instead of relying on EventSource auto-reconnect.
 */
export class SSEAdapter implements TransportAdapter {
	readonly type = "sse" as const;
	private _state: TransportState = "disconnected";
	private abortController: AbortController | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempt = 0;
	private intentionalClose = false;
	private lastEventId: string | undefined;

	private messageHandler: ((event: NotificationEvent, streamId?: string) => void) | null = null;
	private errorHandler: ((error: Error) => void) | null = null;
	private reconnectHandler: (() => void) | null = null;

	private readonly endpoint: string;
	private readonly token: string | undefined;
	private readonly getToken: (() => Promise<string>) | undefined;

	constructor(options: SSEAdapterOptions) {
		this.endpoint = options.endpoint;
		this.token = options.token;
		this.getToken = options.getToken;
		this.lastEventId = options.lastEventId;
	}

	/**
	 * Resolve the current token.
	 * NOTE: only called when a getToken callback is present — the static-token
	 * path stays fully synchronous (see doConnect) so the fetch() call is
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

	/** Update lastEventId from outside */
	setLastEventId(id: string): void {
		this.lastEventId = id;
	}

	private doConnect(): Promise<void> {
		// An async token provider needs the token resolved before connecting;
		// the static-token path stays synchronous so we don't defer the fetch()
		// call by a microtask unnecessarily.
		if (this.getToken) {
			return this.currentToken().then((token) => this.doConnectWithToken(token));
		}
		return this.doConnectWithToken(this.token ?? "");
	}

	private doConnectWithToken(token: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this._state = "connecting";
			this.abortController = new AbortController();
			let settled = false;

			const url = `${this.endpoint.replace(/\/$/, "")}/stream`;
			const headers: Record<string, string> = {
				Authorization: `Bearer ${token}`,
				Accept: "text/event-stream",
			};
			if (this.lastEventId) {
				headers["Last-Event-ID"] = this.lastEventId;
			}

			fetch(url, {
				headers,
				signal: this.abortController.signal,
			})
				.then((response) => {
					if (!response.ok) {
						throw new Error(`SSE connection failed: ${response.status}`);
					}
					if (!response.body) {
						throw new Error("SSE response has no body");
					}

					this._state = "connected";
					this.reconnectAttempt = 0;
					if (!settled) {
						settled = true;
						resolve();
					}

					this.resetHeartbeatTimer();
					void this.readStream(response.body);
				})
				.catch((err: unknown) => {
					if (this.intentionalClose) return;

					const error = err instanceof Error ? err : new Error(String(err));
					this._state = "disconnected";

					if (!settled) {
						settled = true;
						reject(error);
						return;
					}

					this.errorHandler?.(error);
					this.scheduleReconnect();
				});
		});
	}

	private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				this.resetHeartbeatTimer();

				// Process complete SSE events (terminated by double newline)
				const events = buffer.split("\n\n");
				// Last element is an incomplete event (or empty string)
				buffer = events.pop() ?? "";

				for (const raw of events) {
					if (raw.trim()) {
						this.parseSSEEvent(raw);
					}
				}
			}
		} catch (err: unknown) {
			if (this.intentionalClose) return;
			const error = err instanceof Error ? err : new Error(String(err));
			this.errorHandler?.(error);
		} finally {
			reader.releaseLock();
		}

		// Stream ended
		this._state = "disconnected";
		this.clearHeartbeatTimer();
		if (!this.intentionalClose) {
			this.scheduleReconnect();
		}
	}

	private parseSSEEvent(raw: string): void {
		let eventType = "";
		let id = "";
		let data = "";

		for (const line of raw.split("\n")) {
			if (line.startsWith("event:")) {
				eventType = line.slice(6).trim();
			} else if (line.startsWith("id:")) {
				id = line.slice(3).trim();
			} else if (line.startsWith("data:")) {
				data += (data ? "\n" : "") + line.slice(5).trim();
			}
		}

		if (id) {
			this.lastEventId = id;
		}

		if (eventType === "notification" && data) {
			try {
				const parsed = JSON.parse(data) as NotificationEvent;
				if (typeof parsed.timestamp === "string") {
					parsed.timestamp = new Date(parsed.timestamp);
				}
				this.messageHandler?.(parsed, id || undefined);
			} catch {
				// Malformed data — skip
			}
		}
		// heartbeat events reset the timer (already done in readStream)
	}

	private resetHeartbeatTimer(): void {
		this.clearHeartbeatTimer();
		this.heartbeatTimer = setTimeout(() => {
			this.errorHandler?.(new Error("SSE heartbeat timeout"));
			this.abortController?.abort();
		}, HEARTBEAT_TIMEOUT_MS);
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
					// Will retry via stream end handling
				});
		}, delay);
	}

	private cleanup(): void {
		this.clearHeartbeatTimer();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
	}
}
