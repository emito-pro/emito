import type { RedisLike } from "@emito/core";
import type { NotificationEvent } from "@emito/types";

/**
 * Transport-agnostic connection interface.
 * SSE, WebSocket, and other transports implement this to receive events.
 */
export interface Connection {
	readonly id: string;
	write(event: NotificationEvent, streamId?: string): void;
	close(): void;
}

export interface ConnectionRegistryOptions {
	redis?: RedisLike;
	/** Polling interval in ms for XREAD (default: 1000) */
	pollIntervalMs?: number;
	/** Max stream length for XADD MAXLEN (default: 1000) */
	maxStreamLength?: number;
}

const STREAM_KEY_PREFIX = "emito:stream:";

/**
 * Transport-agnostic connection registry.
 * Tracks subscriberId → Set<Connection> and fans out events via Redis Streams.
 * Graceful degradation: works in-process only when Redis is unavailable.
 */
export class ConnectionRegistry {
	private readonly connections = new Map<string, Set<Connection>>();
	private readonly redis?: RedisLike;
	private readonly pollIntervalMs: number;
	private readonly maxStreamLength: number;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	/** Track last-read stream ID per subscriber for XREAD polling */
	private readonly lastReadIds = new Map<string, string>();
	/** B-011 fix: track stream IDs written locally to prevent double-delivery */
	private readonly localStreamIds = new Set<string>();

	constructor(options: ConnectionRegistryOptions = {}) {
		this.redis = options.redis;
		this.pollIntervalMs = options.pollIntervalMs ?? 1000;
		this.maxStreamLength = options.maxStreamLength ?? 1000;
	}

	/**
	 * Register a connection for a subscriber.
	 * Starts Redis Stream polling if this is the first connection for this subscriber on this instance.
	 */
	register(subscriberId: string, connection: Connection): void {
		let set = this.connections.get(subscriberId);
		if (!set) {
			set = new Set();
			this.connections.set(subscriberId, set);
		}
		set.add(connection);
		this.ensurePolling();
	}

	/**
	 * Unregister a connection. Cleans up subscriber entry if no connections remain.
	 */
	unregister(subscriberId: string, connection: Connection): void {
		const set = this.connections.get(subscriberId);
		if (!set) return;
		set.delete(connection);
		if (set.size === 0) {
			this.connections.delete(subscriberId);
			this.lastReadIds.delete(subscriberId);
		}
		if (this.connections.size === 0) {
			this.stopPolling();
		}
	}

	/**
	 * Write event to Redis Stream and broadcast to local connections.
	 * Primary API: called when a notification is created (from handler integration).
	 */
	async broadcast(subscriberId: string, event: NotificationEvent): Promise<void> {
		let streamId: string | undefined;

		// Write to Redis Stream for cross-instance fanout
		if (this.redis) {
			try {
				streamId = await this.redis.xadd(
					`${STREAM_KEY_PREFIX}${subscriberId}`,
					"*",
					"event",
					JSON.stringify(event),
				);
				// B-011 fix: track locally-written stream ID to skip in pollStreams
				this.localStreamIds.add(streamId);
				// Safety: prevent unbounded growth if pollStreams never runs (e.g. Redis flaps)
				if (this.localStreamIds.size > 500) {
					const iter = this.localStreamIds.values();
					for (let i = 0; i < 250; i++) {
						const val = iter.next().value;
						if (val !== undefined) this.localStreamIds.delete(val);
					}
				}
				// Update last-read cursor so pollStreams picks up cross-instance events after this point
				this.lastReadIds.set(subscriberId, streamId);
				// Approximate trim to keep stream bounded
				await this.redis.xtrim(
					`${STREAM_KEY_PREFIX}${subscriberId}`,
					"MAXLEN",
					this.maxStreamLength,
				);
			} catch {
				// Redis unavailable — fall through to local broadcast
			}
		}

		// Local broadcast (same-instance connections)
		this.broadcastLocal(subscriberId, event, streamId);
	}

	/**
	 * Broadcast event to all local connections for a subscriber.
	 */
	private broadcastLocal(subscriberId: string, event: NotificationEvent, streamId?: string): void {
		const set = this.connections.get(subscriberId);
		if (!set) return;
		for (const conn of set) {
			try {
				conn.write(event, streamId);
			} catch {
				// Connection broken — will be cleaned up on disconnect
			}
		}
	}

	/**
	 * Get total number of active connections across all subscribers.
	 */
	getCount(): number {
		let count = 0;
		for (const set of this.connections.values()) {
			count += set.size;
		}
		return count;
	}

	/**
	 * Get all subscriber IDs with active connections.
	 */
	getSubscriberIds(): string[] {
		return Array.from(this.connections.keys());
	}

	/**
	 * Start polling Redis Streams for events from other instances.
	 */
	private ensurePolling(): void {
		if (this.pollTimer || !this.redis) return;
		this.pollTimer = setInterval(() => {
			void this.pollStreams();
		}, this.pollIntervalMs);
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/**
	 * Non-blocking poll of Redis Streams for all connected subscribers.
	 * Uses XREAD (no BLOCK) to avoid tying up Redis connections.
	 */
	private async pollStreams(): Promise<void> {
		if (!this.redis || this.connections.size === 0) return;

		const subscriberIds = this.getSubscriberIds();
		const args = subscriberIds.map((subId) => ({
			key: `${STREAM_KEY_PREFIX}${subId}`,
			id: this.lastReadIds.get(subId) ?? "$",
		}));

		try {
			const results = await this.redis.xread(args);
			if (!results) return;

			for (const [streamKey, entries] of results) {
				const subscriberId = streamKey.slice(STREAM_KEY_PREFIX.length);
				for (const [entryId, fields] of entries) {
					// Update last-read ID
					this.lastReadIds.set(subscriberId, entryId);

					// B-011 fix: skip events we wrote locally (already delivered via broadcastLocal)
					if (this.localStreamIds.has(entryId)) {
						this.localStreamIds.delete(entryId);
						continue;
					}

					// Parse event from fields
					const event = parseStreamEntry(fields);
					if (event) {
						this.broadcastLocal(subscriberId, event, entryId);
					}
				}
			}
		} catch {
			// Redis unavailable — skip this poll cycle
		}
	}

	/**
	 * Stop polling and clean up all connections.
	 */
	destroy(): void {
		this.stopPolling();
		for (const [, set] of this.connections) {
			for (const conn of set) {
				try {
					conn.close();
				} catch {
					// Ignore close errors during shutdown
				}
			}
		}
		this.connections.clear();
		this.lastReadIds.clear();
		this.localStreamIds.clear();
	}
}

/**
 * Factory function for creating a ConnectionRegistry.
 */
export function createConnectionRegistry(
	options: ConnectionRegistryOptions = {},
): ConnectionRegistry {
	return new ConnectionRegistry(options);
}

/**
 * Parse a Redis Stream entry's fields array into a NotificationEvent.
 * Fields are [key, value, key, value, ...] pairs.
 */
export function parseStreamEntry(fields: string[]): NotificationEvent | null {
	for (let i = 0; i < fields.length - 1; i += 2) {
		if (fields[i] === "event") {
			try {
				const value = fields[i + 1];
				if (value == null) return null;
				const parsed = JSON.parse(value) as NotificationEvent;
				// Restore Date object from JSON serialization
				if (typeof parsed.timestamp === "string") {
					parsed.timestamp = new Date(parsed.timestamp);
				}
				return parsed;
			} catch {
				return null;
			}
		}
	}
	return null;
}
