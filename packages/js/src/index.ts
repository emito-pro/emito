// Client
export { EmitoClient } from "./client.js";
export { API_VERSION, resolveApiBase } from "./version.js";

// Event emitter
export { TypedEmitter } from "./events.js";

// Transport adapters
export { WebSocketAdapter } from "./transport/websocket.js";
export { SSEAdapter } from "./transport/sse.js";
export { PollingAdapter } from "./transport/polling.js";
export { TransportManager } from "./transport/manager.js";

// API modules
export { HttpClient } from "./api/http.js";
export { NotificationsApi } from "./api/notifications.js";
export { PreferencesApi } from "./api/preferences.js";
export { IntegrationsApi } from "./api/integrations.js";
export { SubscriptionsApi } from "./api/subscriptions.js";

// State
export { NotificationStore } from "./state/store.js";
export { OptimisticUpdater } from "./state/optimistic.js";

// Storage adapters
export { MemoryStorageAdapter } from "./storage/memory.js";
export { IndexedDBStorageAdapter } from "./storage/indexeddb.js";

// Offline queue
export { ActionQueue } from "./queue/action-queue.js";

// Types
export type {
	TransportType,
	TransportState,
	TransportAdapter,
	TransportConfig,
	WebSocketAdapterOptions,
	SSEAdapterOptions,
	PollingAdapterOptions,
	EmitoClientEventMap,
	EmitoClientOptions,
	StorageAdapter,
	CapabilitiesResponse,
} from "./types.js";

export type { HttpClientConfig } from "./api/http.js";

export type {
	NotificationItem,
	NotificationListParams,
	NotificationListResult,
	UnreadCountResult,
} from "./api/notifications.js";

export type {
	PreferencesResult,
	PreferenceUpdateParams,
} from "./api/preferences.js";

export type {
	Integration,
	IntegrationListResult,
	IntegrationCreateParams,
	IntegrationUpdateParams,
} from "./api/integrations.js";

export type {
	Subscription,
	SubscriptionListResult,
} from "./api/subscriptions.js";

export type {
	NotificationStoreState,
	StateEventMap,
} from "./state/store.js";

export type { IndexedDBAdapterOptions } from "./storage/indexeddb.js";

export type {
	ActionType,
	QueuedAction,
	ActionQueueOptions,
} from "./queue/action-queue.js";
