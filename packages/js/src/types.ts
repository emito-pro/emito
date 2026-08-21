import type { NotificationEvent } from "@emito/types";
import type { StorageAdapter } from "./storage/types.js";

/** Transport type identifier */
export type TransportType = "ws" | "sse" | "polling";

/** Transport adapter readiness states */
export type TransportState = "disconnected" | "connecting" | "connected";

/**
 * Transport adapter interface.
 * Each transport (WebSocket, SSE, polling) implements this contract.
 */
export interface TransportAdapter {
	readonly type: TransportType;
	readonly state: TransportState;

	/** Connect to the server. Resolves when the connection is established. */
	connect(): Promise<void>;

	/** Disconnect from the server. */
	disconnect(): void;

	/** Register a handler for incoming notification messages. */
	onMessage(handler: (event: NotificationEvent, streamId?: string) => void): void;

	/** Register a handler for transport errors. */
	onError(handler: (error: Error) => void): void;

	/** Register a handler called when the transport reconnects after a disconnection. */
	onReconnect(handler: () => void): void;
}

/** Configuration for creating a transport adapter */
export interface TransportConfig {
	/** Versioned API base (e.g. "https://myapp.com/emito/v1") — already resolved by `EmitoClient`. */
	endpoint: string;
	/** Subscriber ID */
	subscriberId: string;
	/** JWT auth token (static). Provide this OR `getToken`. */
	token?: string;
	/** Async token provider; called at connect/reconnect so a short-lived token can refresh without re-instantiating the client. */
	getToken?: () => Promise<string>;
	/** Last received event ID for catch-up on reconnect */
	lastEventId?: string;
}

/** WebSocket auth mode — "cookie" for browser (automatic), "header" for Node/RN (Authorization header) */
export type WsAuthMode = "cookie" | "header";

/** WebSocket adapter options */
export interface WebSocketAdapterOptions extends TransportConfig {
	/** Heartbeat timeout in ms (default: 45000 — 1.5x server's 30s interval) */
	heartbeatTimeoutMs?: number;
	/** WebSocket auth mode. "cookie" sends no auth (browser cookies automatic). "header" sends Authorization header (Node/RN). Auto-detected if omitted. */
	wsAuth?: WsAuthMode;
	/** Explicit WebSocket URL (e.g. "wss://ws.myapp.com/emito/v1/ws"). Overrides derivation from endpoint. */
	wsEndpoint?: string;
}

/** Polling adapter options */
export interface PollingAdapterOptions extends TransportConfig {
	/** Poll interval in ms (default: 10000) */
	intervalMs?: number;
}

/** SSE adapter options */
export type SSEAdapterOptions = TransportConfig;

/** Event map for the EmitoClient event emitter */
export type EmitoClientEventMap = {
	connected: [];
	disconnected: [];
	error: [error: Error];
	notification: [event: NotificationEvent, streamId?: string];
	notifications: [notifications: import("./api/notifications.js").NotificationItem[]];
	unreadCount: [count: number];
	/** Emitted when a queued action fails replay after retry */
	queueError: [error: Error, action: import("./queue/action-queue.js").QueuedAction];
	/** Emitted when a notification is snoozed locally */
	snoozed: [id: string];
};

/** Re-export StorageAdapter from canonical location */
export type { StorageAdapter } from "./storage/types.js";

/** EmitoClient constructor options */
export interface EmitoClientOptions {
	/**
	 * Where Emito is mounted (e.g. "https://myapp.com/emito") — the same value the
	 * host passes as `prefix` to `createEmitoServer`. Do not include the API
	 * version: the client appends the version it speaks (`/v1`) itself.
	 */
	endpoint: string;
	/** Subscriber ID */
	subscriberId: string;
	/** JWT auth token (static). Provide this OR `getToken`. */
	token?: string;
	/** Async token provider; called at connect/reconnect and per REST request so a short-lived token can refresh without re-instantiating the client. */
	getToken?: () => Promise<string>;
	/** Preferred transport. "auto" probes /capabilities and picks best. Default: "auto" */
	transport?: TransportType | "auto";
	/** Poll interval in ms when the polling transport is active (default: 10000). No effect on ws/sse. */
	pollIntervalMs?: number;
	/** Optional storage adapter for offline queue persistence */
	storage?: StorageAdapter;
	/** Maximum offline queue size (default: 100). Oldest actions are dropped when full. */
	maxQueueSize?: number;
	/** WebSocket auth mode. "cookie" for browser (cookies sent automatically). "header" for Node/RN (Authorization header). Auto-detected if omitted. */
	wsAuth?: WsAuthMode;
	/** Explicit WebSocket endpoint URL (e.g. "wss://ws.myapp.com/emito/v1/ws"). When set, overrides the default derivation from `endpoint`. */
	wsEndpoint?: string;
}

/** Capabilities response from the server */
export interface CapabilitiesResponse {
	transports: string[];
}
