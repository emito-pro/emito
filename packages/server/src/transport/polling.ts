import type { RedisLike } from "@emito/core";
import type { NotificationEvent } from "@emito/types";
import { collectionResponse, errorResponse } from "../response.js";
import type { createRouter } from "../router.js";
import { parseStreamEntry } from "./registry.js";

const STREAM_KEY_PREFIX = "emito:stream:";
const DEFAULT_POLL_LIMIT = 50;

export interface PollingEndpointDeps {
	redis?: RedisLike;
}

/**
 * Register the polling endpoint: GET /poll?since={lastEventId}
 * Subscriber JWT auth. Returns events from Redis Stream since the given ID.
 */
export function registerPollingEndpoint(
	router: ReturnType<typeof createRouter>,
	deps: PollingEndpointDeps,
): void {
	router.add({
		method: "GET",
		pathPattern: "/poll",
		auth: "subscriber",
		async handler(ctx, request) {
			if (!deps.redis) {
				return errorResponse({
					code: "TRANSPORT_UNAVAILABLE",
					message: "Polling requires Redis — Redis is not configured",
					statusCode: 503,
				});
			}

			const url = new URL(request.url, "http://localhost");
			const since = url.searchParams.get("since");
			const subscriberId = ctx.subscriberId;
			const streamKey = `${STREAM_KEY_PREFIX}${subscriberId}`;

			let entries: Array<[string, string[]]>;

			try {
				if (since) {
					// Exclusive start — events after the given ID
					entries = await deps.redis.xrange(streamKey, `(${since}`, "+", DEFAULT_POLL_LIMIT);
				} else {
					// No since — return latest events (read last N entries)
					// XRANGE from beginning, limited
					entries = await deps.redis.xrange(streamKey, "-", "+", DEFAULT_POLL_LIMIT);
				}
			} catch {
				return errorResponse({
					code: "TRANSPORT_UNAVAILABLE",
					message: "Failed to read from Redis Stream",
					statusCode: 503,
				});
			}

			const items: Array<{ id: string; event: NotificationEvent }> = [];
			for (const [entryId, fields] of entries) {
				const event = parseStreamEntry(fields);
				if (event) {
					items.push({ id: entryId, event });
				}
			}

			return collectionResponse(items, false);
		},
	});
}
