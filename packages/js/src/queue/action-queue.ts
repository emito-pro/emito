import type { StorageAdapter } from "../storage/types.js";

const STORAGE_KEY = "emito:action-queue";

/** Supported offline action types — write operations that can be replayed */
export type ActionType =
	| "markAsRead"
	| "markAsUnread"
	| "archive"
	| "unarchive"
	| "snooze"
	| "markAllAsRead"
	| "preferenceUpdate"
	| "preferenceReset"
	| "subscribe"
	| "unsubscribe";

/** A serializable action stored in the queue */
export interface QueuedAction {
	id: string;
	type: ActionType;
	args: unknown[];
	createdAt: string;
}

export interface ActionQueueOptions {
	/** Maximum number of actions to buffer (default: 100) */
	maxSize?: number;
	/** Storage adapter for persistence (optional — queue is in-memory only if omitted) */
	storage?: StorageAdapter;
}

type ReplayHandler = (action: QueuedAction) => Promise<void>;
type ErrorHandler = (error: Error, action: QueuedAction) => void;

/**
 * Offline action queue — buffers write operations when the client is disconnected.
 * On reconnect, replays queued actions in order. Failed replays are retried once,
 * then discarded with an error event.
 */
export class ActionQueue {
	private queue: QueuedAction[] = [];
	private readonly maxSize: number;
	private readonly storage: StorageAdapter | null;
	private replayHandler: ReplayHandler | null = null;
	private errorHandler: ErrorHandler | null = null;
	private flushing = false;
	private idCounter = 0;

	constructor(options?: ActionQueueOptions) {
		this.maxSize = options?.maxSize ?? 100;
		this.storage = options?.storage ?? null;
	}

	/** Register the handler that replays a single action via the API */
	onReplay(handler: ReplayHandler): void {
		this.replayHandler = handler;
	}

	/** Register the handler called when a replayed action fails after retry */
	onError(handler: ErrorHandler): void {
		this.errorHandler = handler;
	}

	/** Number of actions currently in the queue */
	get size(): number {
		return this.queue.length;
	}

	/** Whether the queue is currently flushing */
	get isFlushing(): boolean {
		return this.flushing;
	}

	/**
	 * Enqueue a write action. If the queue is at capacity, the oldest action
	 * is dropped (FIFO eviction).
	 */
	async enqueue(type: ActionType, args: unknown[]): Promise<void> {
		const action: QueuedAction = {
			id: `${Date.now()}-${this.idCounter++}`,
			type,
			args,
			createdAt: new Date().toISOString(),
		};

		if (this.queue.length >= this.maxSize) {
			this.queue.shift(); // drop oldest
		}

		this.queue.push(action);
		await this.persist();
	}

	/**
	 * Flush the queue — replay all actions in order.
	 * Each failed action is retried once. If it fails again, it's discarded
	 * and the error handler is called.
	 */
	async flush(): Promise<void> {
		if (this.flushing || this.queue.length === 0) return;
		if (!this.replayHandler) return;

		this.flushing = true;
		try {
			while (this.queue.length > 0) {
				const action = this.queue[0];
				if (!action) break;

				try {
					await this.replayHandler(action);
				} catch {
					// Retry once
					try {
						await this.replayHandler(action);
					} catch (retryError) {
						// Discard with error event
						this.errorHandler?.(
							retryError instanceof Error ? retryError : new Error(String(retryError)),
							action,
						);
					}
				}

				// Remove the action regardless of success/failure
				this.queue.shift();
				await this.persist();
			}
		} finally {
			this.flushing = false;
		}
	}

	/** Clear all queued actions */
	async clear(): Promise<void> {
		this.queue = [];
		await this.persist();
	}

	/** Load queue from storage (call on init) */
	async restore(): Promise<void> {
		if (!this.storage) return;

		const raw = await this.storage.getItem(STORAGE_KEY);
		if (!raw) return;

		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				this.queue = parsed as QueuedAction[];
			}
		} catch {
			// Corrupted data — start fresh
			this.queue = [];
		}
	}

	/** Get a snapshot of the current queue (for debugging/testing) */
	getActions(): ReadonlyArray<QueuedAction> {
		return this.queue;
	}

	private async persist(): Promise<void> {
		if (!this.storage) return;
		await this.storage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
	}
}
