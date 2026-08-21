import type { RedisLike } from "@emito/core";
import type { NotificationEvent } from "@emito/types";
import type { createRouter } from "../router.js";
import type { Connection, ConnectionRegistry } from "./registry.js";
import { parseStreamEntry } from "./registry.js";

const STREAM_KEY_PREFIX = "emito:stream:";
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Format a NotificationEvent as an SSE message.
 */
function formatSSE(event: NotificationEvent, streamId?: string): string {
	const lines: string[] = [];
	lines.push("event: notification");
	if (streamId) {
		lines.push(`id: ${streamId}`);
	}
	lines.push(`data: ${JSON.stringify(event)}`);
	lines.push("", ""); // double newline to end the event
	return lines.join("\n");
}

function formatHeartbeat(): string {
	return "event: heartbeat\ndata: {}\n\n";
}

export interface SSEEndpointDeps {
	registry: ConnectionRegistry;
	redis?: RedisLike;
}

/**
 * Register the SSE endpoint: GET /stream
 * Subscriber JWT auth, text/event-stream response via ReadableStream.
 */
export function registerSSEEndpoint(
	router: ReturnType<typeof createRouter>,
	deps: SSEEndpointDeps,
): void {
	router.add({
		method: "GET",
		pathPattern: "/stream",
		auth: "subscriber",
		handler(ctx, request) {
			const subscriberId = ctx.subscriberId;
			const lastEventId = request.headers.get("Last-Event-ID") ?? undefined;

			let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
			let closed = false;

			const stream = new ReadableStream<Uint8Array>({
				async start(controller) {
					const encoder = new TextEncoder();

					// Catch-up from Last-Event-ID if available
					if (lastEventId && deps.redis) {
						try {
							const entries = await deps.redis.xrange(
								`${STREAM_KEY_PREFIX}${subscriberId}`,
								// XRANGE is inclusive on start — use the next ID after lastEventId
								`(${lastEventId}`,
								"+",
								100,
							);
							for (const [entryId, fields] of entries) {
								const event = parseStreamEntry(fields);
								if (event && !closed) {
									controller.enqueue(encoder.encode(formatSSE(event, entryId)));
								}
							}
						} catch {
							// Redis unavailable — skip catch-up, start from now
						}
					}

					// Create connection for the registry
					const connection: Connection = {
						id: `sse-${subscriberId}-${Date.now()}`,
						write(event: NotificationEvent, streamId?: string) {
							if (closed) return;
							try {
								controller.enqueue(encoder.encode(formatSSE(event, streamId)));
							} catch {
								// Stream closed
							}
						},
						close() {
							if (closed) return;
							closed = true;
							if (heartbeatTimer) {
								clearInterval(heartbeatTimer);
								heartbeatTimer = null;
							}
							try {
								controller.close();
							} catch {
								// Already closed
							}
						},
					};

					// Register in the connection registry
					deps.registry.register(subscriberId, connection);

					// Heartbeat every 30s — guard against early disconnect during xrange catch-up
					if (closed) return;
					heartbeatTimer = setInterval(() => {
						if (closed) return;
						try {
							controller.enqueue(encoder.encode(formatHeartbeat()));
						} catch {
							// Stream closed — clean up
							connection.close();
							deps.registry.unregister(subscriberId, connection);
						}
					}, HEARTBEAT_INTERVAL_MS);

					// Handle client disconnect via AbortSignal
					request.signal.addEventListener("abort", () => {
						deps.registry.unregister(subscriberId, connection);
						connection.close();
					});
				},
			});

			return Promise.resolve(
				new Response(stream, {
					status: 200,
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					},
				}),
			);
		},
	});
}
