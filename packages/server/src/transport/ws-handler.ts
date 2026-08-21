import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import type { InboxRepository, RedisLike } from "@emito/core";
import type { NotificationEvent, ResolveSubscriberId } from "@emito/types";
import { type WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { Connection, ConnectionRegistry } from "./registry.js";
import { parseStreamEntry } from "./registry.js";
import { toWebRequest } from "./to-web-request.js";

const STREAM_KEY_PREFIX = "emito:stream:";
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

/** Zod schema for incoming WS messages — validated at system boundary */
const wsMessageSchema = z.object({
	type: z.string(),
	notificationId: z.string().optional(),
});

/** Redis Stream ID format: timestamp-sequence (e.g. "1710000000000-0") */
const STREAM_ID_RE = /^\d+-\d+$/;
/** WebSocket OPEN readyState value (avoids dependency on ws static which may be mocked) */
const WS_OPEN = 1;

export interface WsHandlerConfig {
	/** Versioned API base (e.g. `/emito/v1`) — the upgrade path is `${basePath}/ws`. */
	basePath: string;
	registry: ConnectionRegistry;
	redis?: RedisLike;
	inboxRepository: InboxRepository;
	resolveSubscriberId: ResolveSubscriberId;
}

/**
 * Creates a WebSocket upgrade handler.
 * Returns an async function suitable for `httpServer.on('upgrade', handler)`.
 */
export function createWsUpgradeHandler(
	config: WsHandlerConfig,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void> {
	const wss = new WebSocketServer({ noServer: true });
	const wsPath = `${config.basePath}/ws`;

	return async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
		// Path check: only handle upgrade requests matching basePath/ws
		const url = new URL(req.url ?? "/", "http://localhost");
		if (url.pathname !== wsPath) {
			return; // pass through — not our path
		}

		const webRequest = toWebRequest(req);

		// Resolve subscriber identity
		let subscriberId: string | null = null;

		try {
			subscriberId = await config.resolveSubscriberId(webRequest);
		} catch {
			// Hook threw — treat as auth failure
		}

		if (!subscriberId) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}

		const resolvedSubscriberId = subscriberId;

		wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
			handleConnection(config, ws, resolvedSubscriberId, url);
		});
	};
}

function handleConnection(
	config: WsHandlerConfig,
	ws: WebSocket,
	subscriberId: string,
	url: URL,
): void {
	let alive = true;
	let pingTimer: ReturnType<typeof setInterval> | null = null;
	let pongTimer: ReturnType<typeof setTimeout> | null = null;

	// Create Connection implementing the transport-agnostic interface
	const connection: Connection = {
		id: `ws-${subscriberId}-${Date.now()}`,
		write(event: NotificationEvent, streamId?: string) {
			if (ws.readyState !== WS_OPEN) return;
			try {
				ws.send(
					JSON.stringify({
						type: "notification",
						id: streamId,
						data: event,
					}),
				);
			} catch {
				// Send failed — connection will be cleaned up on close/error
			}
		},
		close() {
			cleanup();
			try {
				ws.close();
			} catch {
				// Already closed
			}
		},
	};

	// Register with ConnectionRegistry
	config.registry.register(subscriberId, connection);

	// Catch-up from lastEventId query param (validated — untrusted client input)
	const lastEventId = url.searchParams.get("lastEventId");
	if (lastEventId && STREAM_ID_RE.test(lastEventId) && config.redis) {
		void catchUp(config.redis, ws, subscriberId, lastEventId);
	}

	// Ping/pong heartbeat
	pingTimer = setInterval(() => {
		if (!alive) {
			// No pong received since last ping — terminate
			cleanup();
			config.registry.unregister(subscriberId, connection);
			ws.terminate();
			return;
		}
		alive = false;
		ws.ping();
		// Send application-level heartbeat message
		if (ws.readyState === WS_OPEN) {
			try {
				ws.send(JSON.stringify({ type: "heartbeat" }));
			} catch {
				// Send failed
			}
		}
		// Set pong timeout
		pongTimer = setTimeout(() => {
			if (!alive) {
				cleanup();
				config.registry.unregister(subscriberId, connection);
				ws.terminate();
			}
		}, PONG_TIMEOUT_MS);
	}, PING_INTERVAL_MS);

	ws.on("pong", () => {
		alive = true;
		if (pongTimer) {
			clearTimeout(pongTimer);
			pongTimer = null;
		}
	});

	// Handle incoming messages
	ws.on("message", (data: unknown) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(String(data));
		} catch {
			return; // Malformed JSON — ignore
		}

		const result = wsMessageSchema.safeParse(parsed);
		if (!result.success) return;

		const msg = result.data;

		switch (msg.type) {
			case "ack":
				// Protocol placeholder — no-op
				break;
			case "mark_read":
				if (msg.notificationId) {
					void handleMarkRead(config.inboxRepository, subscriberId, msg.notificationId, ws);
				}
				break;
			default:
				// Unknown type — ignore (forward compatibility)
				break;
		}
	});

	ws.on("close", () => {
		cleanup();
		config.registry.unregister(subscriberId, connection);
	});

	ws.on("error", () => {
		cleanup();
		config.registry.unregister(subscriberId, connection);
	});

	function cleanup(): void {
		if (pingTimer) {
			clearInterval(pingTimer);
			pingTimer = null;
		}
		if (pongTimer) {
			clearTimeout(pongTimer);
			pongTimer = null;
		}
	}
}

async function catchUp(
	redis: RedisLike,
	ws: WebSocket,
	subscriberId: string,
	lastEventId: string,
): Promise<void> {
	try {
		const entries = await redis.xrange(
			`${STREAM_KEY_PREFIX}${subscriberId}`,
			`(${lastEventId}`,
			"+",
			100,
		);
		for (const [entryId, fields] of entries) {
			const event = parseStreamEntry(fields);
			if (event && ws.readyState === WS_OPEN) {
				ws.send(
					JSON.stringify({
						type: "notification",
						id: entryId,
						data: event,
					}),
				);
			}
		}
	} catch {
		// Redis unavailable — skip catch-up
	}
}

async function handleMarkRead(
	inboxRepository: InboxRepository,
	subscriberId: string,
	notificationId: string,
	ws: WebSocket,
): Promise<void> {
	try {
		const record = await inboxRepository.findById(notificationId);
		if (!record || record.subscriberId !== subscriberId) {
			if (ws.readyState === WS_OPEN) {
				ws.send(
					JSON.stringify({
						type: "error",
						message: "Notification not found or access denied",
					}),
				);
			}
			return;
		}
		await inboxRepository.updateReadAt(notificationId);
	} catch {
		// Silently ignore — don't crash the connection for a mark_read failure
	}
}
