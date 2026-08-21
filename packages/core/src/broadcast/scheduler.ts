import type { Logger } from "../observability/logger";
import type { RedisLike } from "../redis/types";
import type { BroadcastService } from "./service";
import type { BroadcastRequest } from "./types";

const SCHEDULED_SET_KEY = "emito:broadcast:scheduled";
const DEFAULT_POLL_INTERVAL_MS = 30_000;

export interface BroadcastScheduler {
	schedule(request: BroadcastRequest, broadcastId: string): Promise<void>;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface BroadcastSchedulerDeps {
	redis: RedisLike;
	broadcastService: BroadcastService;
	logger: Logger;
	pollIntervalMs?: number;
}

export function createBroadcastScheduler(deps: BroadcastSchedulerDeps): BroadcastScheduler {
	const { redis, broadcastService, logger } = deps;
	const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let activeExecution: Promise<void> | null = null;

	async function schedule(request: BroadcastRequest, broadcastId: string): Promise<void> {
		if (!request.scheduledAt) {
			throw new Error("scheduledAt is required for scheduling");
		}
		const member = JSON.stringify({ id: broadcastId, request });
		await redis.zadd(SCHEDULED_SET_KEY, request.scheduledAt.getTime(), member);
		logger.info(
			{ broadcastId, scheduledAt: request.scheduledAt.toISOString() },
			"broadcast scheduled",
		);
	}

	async function poll(): Promise<void> {
		try {
			const now = Date.now();
			const due = await redis.zrangebyscore(SCHEDULED_SET_KEY, "-inf", now);

			if (due.length === 0) return;

			for (const member of due) {
				const removed = await redis.zrem(SCHEDULED_SET_KEY, member);
				if (removed === 0) continue;

				const { id, request } = JSON.parse(member) as {
					id: string;
					request: BroadcastRequest;
				};

				logger.info(
					{ broadcastId: id, listSlug: request.listSlug },
					"executing scheduled broadcast",
				);

				try {
					await broadcastService.executeBroadcast(request, id);
				} catch (err) {
					logger.error(
						{ broadcastId: id, error: String(err) },
						"scheduled broadcast execution failed",
					);
				}
			}
		} catch (err) {
			logger.error({ error: String(err) }, "broadcast scheduler poll error");
		}
	}

	async function recoverInFlight(): Promise<void> {
		try {
			let scanCursor = "0";
			do {
				const [nextCursor, keys] = await redis.scan(scanCursor, "emito:broadcast:progress:*", 100);
				scanCursor = nextCursor;

				for (const key of keys) {
					const progress = await redis.hgetall(key);
					if (progress.status === "running") {
						const broadcastId = key.replace("emito:broadcast:progress:", "");
						logger.info({ broadcastId }, "recovering in-flight broadcast");
						try {
							await broadcastService.resumeBroadcast(broadcastId);
						} catch (err) {
							logger.error({ broadcastId, error: String(err) }, "broadcast crash recovery failed");
						}
					}
				}
			} while (scanCursor !== "0");
		} catch (err) {
			logger.error({ error: String(err) }, "broadcast crash recovery scan failed");
		}
	}

	async function start(): Promise<void> {
		logger.info({ pollIntervalMs }, "starting broadcast scheduler");
		await recoverInFlight();
		pollTimer = setInterval(() => {
			activeExecution = poll();
		}, pollIntervalMs);
	}

	async function stop(): Promise<void> {
		logger.info("stopping broadcast scheduler");
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		if (activeExecution) {
			await activeExecution;
			activeExecution = null;
		}
	}

	return { schedule, start, stop };
}
