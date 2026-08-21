import type { NotificationEvent } from "@emito/types";
import type { PollingAdapterOptions, TransportAdapter, TransportState } from "../types.js";

const DEFAULT_POLL_INTERVAL_MS = 10_000;

interface PollItem {
	id: string;
	event: NotificationEvent;
}

interface PollResponse {
	data: {
		items: PollItem[];
		hasMore: boolean;
	};
}

/**
 * Polling transport adapter.
 * Periodically fetches `GET {endpoint}/poll?since={lastEventId}`.
 */
export class PollingAdapter implements TransportAdapter {
	readonly type = "polling" as const;
	private _state: TransportState = "disconnected";
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private abortController: AbortController | null = null;
	private lastEventId: string | undefined;
	private polling = false;

	private messageHandler: ((event: NotificationEvent, streamId?: string) => void) | null = null;
	private errorHandler: ((error: Error) => void) | null = null;
	private reconnectHandler: (() => void) | null = null;

	private readonly endpoint: string;
	private readonly token: string | undefined;
	private readonly getToken: (() => Promise<string>) | undefined;
	private readonly intervalMs: number;

	constructor(options: PollingAdapterOptions) {
		this.endpoint = options.endpoint;
		this.token = options.token;
		this.getToken = options.getToken;
		this.lastEventId = options.lastEventId;
		this.intervalMs = Math.max(1000, options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS);
	}

	private async currentToken(): Promise<string> {
		return this.getToken ? await this.getToken() : (this.token ?? "");
	}

	get state(): TransportState {
		return this._state;
	}

	async connect(): Promise<void> {
		if (this._state === "connected" || this._state === "connecting") {
			return;
		}

		this._state = "connecting";

		// Do an initial poll to verify connectivity
		try {
			await this.poll();
		} catch (err) {
			this._state = "disconnected";
			throw err instanceof Error ? err : new Error(String(err));
		}

		this._state = "connected";
		this.startPolling();
	}

	disconnect(): void {
		this.stopPolling();
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

	private startPolling(): void {
		if (this.pollTimer) return;
		this.pollTimer = setInterval(() => {
			void this.safePoll();
		}, this.intervalMs);
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
	}

	private async safePoll(): Promise<void> {
		if (this.polling) return; // Skip if previous poll is still in-flight
		this.polling = true;
		try {
			await this.poll();
			if (this._state === "disconnected") {
				// Recovered from a failed poll
				this._state = "connected";
				this.reconnectHandler?.();
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			const wasConnected = this._state === "connected";
			this._state = "disconnected";
			const error = err instanceof Error ? err : new Error(String(err));
			this.errorHandler?.(error);
			if (wasConnected) {
				// Keep polling — will recover when server comes back
			}
		} finally {
			this.polling = false;
		}
	}

	private async poll(): Promise<void> {
		this.abortController = new AbortController();

		const base = this.endpoint.replace(/\/$/, "");
		const params = new URLSearchParams();
		if (this.lastEventId) {
			params.set("since", this.lastEventId);
		}
		const qs = params.toString();
		const url = `${base}/poll${qs ? `?${qs}` : ""}`;

		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${await this.currentToken()}`,
			},
			signal: this.abortController.signal,
		});

		if (!response.ok) {
			throw new Error(`Poll request failed: ${response.status}`);
		}

		const body = (await response.json()) as PollResponse;
		const items = body.data?.items;
		if (!Array.isArray(items)) return;

		for (const item of items) {
			if (item.id) {
				this.lastEventId = item.id;
			}
			if (item.event) {
				// Restore Date from JSON
				if (typeof item.event.timestamp === "string") {
					item.event.timestamp = new Date(item.event.timestamp);
				}
				this.messageHandler?.(item.event, item.id);
			}
		}
	}
}
