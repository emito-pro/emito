import type { NotificationEvent } from "@emito/types";
import { HttpClient } from "./api/http.js";
import { IntegrationsApi } from "./api/integrations.js";
import { type NotificationItem, NotificationsApi } from "./api/notifications.js";
import type { PreferenceUpdateParams } from "./api/preferences.js";
import { PreferencesApi } from "./api/preferences.js";
import { SubscriptionsApi } from "./api/subscriptions.js";
import { TypedEmitter } from "./events.js";
import { ActionQueue, type QueuedAction } from "./queue/action-queue.js";
import { OptimisticUpdater } from "./state/optimistic.js";
import { NotificationStore } from "./state/store.js";
import { TransportManager } from "./transport/manager.js";
import type {
	EmitoClientEventMap,
	EmitoClientOptions,
	TransportAdapter,
	TransportType,
} from "./types.js";
import { resolveApiBase } from "./version.js";

/**
 * Emito client — connects to the Emito server for real-time notifications.
 *
 * @example
 * ```ts
 * const client = new EmitoClient({
 *   endpoint: 'https://myapp.com/emito',
 *   subscriberId: 'user_123',
 *   token: 'jwt_token',
 * });
 *
 * client.on('notification', (event) => {
 *   console.log(event.notificationId, event.body);
 * });
 *
 * await client.connect();
 * ```
 */
export class EmitoClient extends TypedEmitter<EmitoClientEventMap> {
	private readonly options: EmitoClientOptions;
	private readonly transportManager: TransportManager;
	private readonly store: NotificationStore;
	private readonly optimistic: OptimisticUpdater;
	private readonly actionQueue: ActionQueue;
	private transport: TransportAdapter | null = null;
	private lastEventId: string | undefined;
	private connected = false;
	private connecting = false;
	private connectGeneration = 0;

	/** REST API: notification operations */
	readonly notifications: NotificationsApi;
	/** REST API: preference operations */
	readonly preferences: PreferencesApi;
	/** REST API: personal integration operations */
	readonly integrations: IntegrationsApi;
	/** REST API: marketing list subscription operations */
	readonly subscriptions: SubscriptionsApi;

	constructor(options: EmitoClientOptions) {
		super();
		if (!options.token && !options.getToken) {
			throw new Error("EmitoClient requires token or getToken");
		}
		this.options = {
			...options,
			transport: options.transport ?? "auto",
		};
		// `endpoint` is the mount path; the version segment is the SDK's own
		// concern, so it is resolved once here and every consumer below — REST and
		// all three transports — inherits it.
		const apiBase = resolveApiBase(options.endpoint);

		this.transportManager = new TransportManager({
			endpoint: apiBase,
			subscriberId: options.subscriberId,
			token: options.token,
			getToken: options.getToken,
			wsAuth: options.wsAuth,
			wsEndpoint: options.wsEndpoint,
			pollIntervalMs: options.pollIntervalMs,
		});

		const http = new HttpClient({
			endpoint: apiBase,
			token: options.token,
			getToken: options.getToken,
		});

		this.notifications = new NotificationsApi(http);
		this.preferences = new PreferencesApi(http);
		this.integrations = new IntegrationsApi(http);
		this.subscriptions = new SubscriptionsApi(http);

		this.store = new NotificationStore();
		// biome-ignore lint/suspicious/noExplicitAny: EmitoClientEventMap is a superset of StateEventMap
		this.store.bind(this as any);
		this.optimistic = new OptimisticUpdater(this.store, this.notifications);

		this.actionQueue = new ActionQueue({
			maxSize: options.maxQueueSize,
			storage: options.storage,
		});
		this.actionQueue.onReplay((action) => this.replayAction(action));
		this.actionQueue.onError((error, action) => this.emit("queueError", error, action));
	}

	/** Whether the client is currently connected */
	get isConnected(): boolean {
		return this.connected;
	}

	/** The active transport type, or null if not connected */
	get activeTransport(): TransportType | null {
		return this.transport?.type ?? null;
	}

	/** Number of actions currently queued for replay */
	get queueSize(): number {
		return this.actionQueue.size;
	}

	/** Get the current notification list from state */
	getNotifications(): NotificationItem[] {
		return this.store.getNotifications();
	}

	/** Get the current unread count from state */
	getUnreadCount(): number {
		return this.store.getUnreadCount();
	}

	/**
	 * Connect to the Emito server.
	 * If transport is "auto", probes capabilities and selects the best transport.
	 */
	async connect(): Promise<void> {
		if (this.connected || this.connecting) return;
		this.connecting = true;
		const generation = ++this.connectGeneration;

		try {
			// Restore any persisted queue from storage
			if (this.options.storage) {
				await this.actionQueue.restore();
			}

			if (generation !== this.connectGeneration) return;

			const transportOption = this.options.transport ?? "auto";
			let adapter: TransportAdapter;

			if (transportOption === "auto") {
				adapter = await this.transportManager.selectAndConnect(this.lastEventId);
			} else {
				adapter = this.transportManager.createAdapter(transportOption, this.lastEventId);
				await adapter.connect();
			}

			if (generation !== this.connectGeneration) {
				adapter.disconnect();
				return;
			}

			this.transport = adapter;
			this.wireTransport(this.transport);
			this.connected = true;

			// Flush queued actions before notifying consumers
			await this.actionQueue.flush();
			this.emit("connected");
		} finally {
			this.connecting = false;
		}
	}

	/**
	 * Disconnect from the Emito server.
	 */
	disconnect(): void {
		this.connecting = false;
		this.connectGeneration++;

		if (!this.connected && !this.transport) return;

		this.connected = false;
		if (this.transport) {
			this.transport.disconnect();
			this.transport = null;
		}
		this.emit("disconnected");
	}

	/**
	 * Fetch notifications and update state.
	 * Convenience method that calls the API and updates the store.
	 */
	async fetchNotifications(params?: Parameters<NotificationsApi["list"]>[0]): Promise<void> {
		const result = await this.notifications.list(params);
		this.store.setNotifications(result.items);
	}

	/**
	 * Fetch unread count and update state.
	 */
	async fetchUnreadCount(): Promise<void> {
		const count = await this.notifications.unreadCount();
		this.store.setUnreadCount(count);
	}

	/**
	 * Optimistically mark a notification as read.
	 * State updates immediately; reverts on server error.
	 * When offline, the action is queued for replay on reconnect.
	 */
	async markAsRead(id: string): Promise<void> {
		if (!this.connected) {
			this.store.markAsRead(id);
			await this.actionQueue.enqueue("markAsRead", [id]);
			return;
		}
		return this.optimistic.markAsRead(id);
	}

	/**
	 * Mark a notification as unread and update state.
	 * When offline, the action is queued for replay on reconnect.
	 */
	async markAsUnread(id: string): Promise<void> {
		if (!this.connected) {
			this.store.markAsUnread(id);
			await this.actionQueue.enqueue("markAsUnread", [id]);
			return;
		}
		await this.notifications.markAsUnread(id);
		this.store.markAsUnread(id);
	}

	/**
	 * Archive a notification.
	 * When offline, the action is queued for replay on reconnect.
	 */
	async archive(id: string): Promise<void> {
		if (!this.connected) {
			this.store.archive(id);
			await this.actionQueue.enqueue("archive", [id]);
			return;
		}
		await this.notifications.archive(id);
		this.store.archive(id);
	}

	/**
	 * Unarchive a notification.
	 * When offline, the action is queued for replay on reconnect.
	 *
	 * No optimistic store update here (unlike archive) — the archived item
	 * was already removed from the local list, so we don't have its data to
	 * re-insert. The store refreshes on reconnect after the queued action replays.
	 */
	async unarchive(id: string): Promise<void> {
		if (!this.connected) {
			await this.actionQueue.enqueue("unarchive", [id]);
			return;
		}
		await this.notifications.unarchive(id);
	}

	/**
	 * Mark all notifications as read and update state.
	 * When offline, the action is queued for replay on reconnect.
	 */
	async markAllAsRead(): Promise<void> {
		if (!this.connected) {
			this.store.markAllAsRead();
			await this.actionQueue.enqueue("markAllAsRead", []);
			return;
		}
		await this.notifications.markAllAsRead();
		this.store.markAllAsRead();
	}

	/**
	 * Update a preference.
	 * When offline, the action is queued for replay on reconnect.
	 */
	async updatePreference(params: PreferenceUpdateParams): Promise<void> {
		if (!this.connected) {
			await this.actionQueue.enqueue("preferenceUpdate", [params]);
			return;
		}
		await this.preferences.update(params);
	}

	private wireTransport(adapter: TransportAdapter): void {
		adapter.onMessage((event: NotificationEvent, streamId?: string) => {
			if (streamId) {
				this.lastEventId = streamId;
			}
			this.emit("notification", event, streamId);
			// Wire real-time events into state
			this.store.handleRealtimeNotification(event);
		});

		adapter.onError((error: Error) => {
			this.emit("error", error);
			if (this.connected) {
				// Transport reported error but may reconnect automatically
				this.connected = false;
				this.emit("disconnected");
			}
		});

		adapter.onReconnect(() => {
			this.connected = true;
			// Flush queued actions before notifying consumers
			this.actionQueue
				.flush()
				.then(() => {
					this.emit("connected");
				})
				.catch((err) => {
					this.emit("error", err instanceof Error ? err : new Error(String(err)));
					this.emit("connected");
				});
		});
	}

	/**
	 * Replay a single queued action by dispatching to the appropriate API method.
	 */
	private async replayAction(action: QueuedAction): Promise<void> {
		switch (action.type) {
			case "markAsRead":
				await this.notifications.markAsRead(action.args[0] as string);
				break;
			case "markAsUnread":
				await this.notifications.markAsUnread(action.args[0] as string);
				break;
			case "archive":
				await this.notifications.archive(action.args[0] as string);
				break;
			case "unarchive":
				await this.notifications.unarchive(action.args[0] as string);
				break;
			case "snooze":
				await this.notifications.snooze(
					action.args[0] as string,
					new Date(action.args[1] as string),
				);
				break;
			case "markAllAsRead":
				await this.notifications.markAllAsRead();
				break;
			case "preferenceUpdate":
				await this.preferences.update(action.args[0] as PreferenceUpdateParams);
				break;
			case "preferenceReset":
				await this.preferences.reset();
				break;
			case "subscribe":
				await this.subscriptions.subscribe(action.args[0] as string);
				break;
			case "unsubscribe":
				await this.subscriptions.unsubscribe(action.args[0] as string);
				break;
		}
	}
}
