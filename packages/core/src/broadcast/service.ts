import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { SendParams, SendResult } from "@emito/types";
import type { Logger } from "../observability/logger";
import type { RedisLike } from "../redis/types";
import type { ListMemberRepository } from "../repositories/list-member-repository";
import type { ListRepository } from "../repositories/list-repository";
import type { BroadcastRecord, BroadcastRequest, BroadcastStatus } from "./types";

const BATCH_SIZE = 100;
const LOCK_TTL_SECONDS = 300;

export interface BroadcastServiceDeps {
	listRepository: ListRepository;
	listMemberRepository: ListMemberRepository;
	redis: RedisLike;
	send: (params: SendParams) => Promise<SendResult>;
	logger: Logger;
}

function broadcastLockKey(broadcastId: string): string {
	return `emito:broadcast:lock:${broadcastId}`;
}

function broadcastProgressKey(broadcastId: string): string {
	return `emito:broadcast:progress:${broadcastId}`;
}

export class BroadcastService {
	private readonly listRepository: ListRepository;
	private readonly listMemberRepository: ListMemberRepository;
	private readonly redis: RedisLike;
	private readonly send: (params: SendParams) => Promise<SendResult>;
	private readonly logger: Logger;

	constructor(deps: BroadcastServiceDeps) {
		this.listRepository = deps.listRepository;
		this.listMemberRepository = deps.listMemberRepository;
		this.redis = deps.redis;
		this.send = deps.send;
		this.logger = deps.logger;
	}

	async executeBroadcast(
		request: BroadcastRequest,
		broadcastId?: string,
	): Promise<BroadcastRecord> {
		const list = await this.listRepository.findBySlug(request.listSlug);
		if (!list) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: `List "${request.listSlug}" not found`,
				isRetryable: false,
			});
		}
		if (list.archivedAt) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: `List "${request.listSlug}" is archived`,
				isRetryable: false,
			});
		}

		const confirmedCount = await this.listMemberRepository.countConfirmed(list.id);
		if (confirmedCount === 0) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: `List "${request.listSlug}" has no confirmed members`,
				isRetryable: false,
			});
		}

		const id = broadcastId ?? crypto.randomUUID();
		const lockKey = broadcastLockKey(id);
		const lockResult = await this.redis.set(lockKey, "1", "NX", "EX", LOCK_TTL_SECONDS);
		if (lockResult !== "OK") {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: `Broadcast ${id} is already running`,
				isRetryable: false,
			});
		}

		const now = new Date();
		const progressKey = broadcastProgressKey(id);

		await this.redis.hset(progressKey, "status", "running");
		await this.redis.hset(progressKey, "offset", "");
		await this.redis.hset(progressKey, "total", String(confirmedCount));
		await this.redis.hset(progressKey, "listSlug", request.listSlug);
		await this.redis.hset(progressKey, "event", request.event);
		await this.redis.hset(progressKey, "payload", JSON.stringify(request.payload));
		await this.redis.hset(progressKey, "startedAt", now.toISOString());

		const record: BroadcastRecord = {
			id,
			listSlug: request.listSlug,
			event: request.event,
			payload: request.payload,
			scheduledAt: request.scheduledAt,
			status: "running",
			createdAt: now,
			startedAt: now,
			memberCount: confirmedCount,
			processedCount: 0,
		};

		try {
			let processed = 0;
			let cursor: string | undefined;

			do {
				const page = await this.listMemberRepository.listByList(list.id, {
					status: "confirmed",
					limit: BATCH_SIZE,
					cursor,
				});

				for (const member of page.items) {
					try {
						await this.send({
							event: request.event,
							subscriberId: member.subscriberId,
							payload: request.payload,
						});
					} catch (sendErr) {
						this.logger.warn(
							{ broadcastId: id, subscriberId: member.subscriberId, error: String(sendErr) },
							"broadcast send failed for member",
						);
					}
					processed++;
				}

				cursor = page.cursor;
				await this.redis.hset(progressKey, "offset", cursor ?? "");
				await this.redis.hset(progressKey, "processed", String(processed));

				if (page.hasMore) {
					await new Promise((resolve) => setImmediate(resolve));
				}
			} while (cursor);

			record.processedCount = processed;
			record.status = "completed";
			record.completedAt = new Date();
			await this.updateProgressStatus(progressKey, "completed");
			await this.redis.del(lockKey);

			this.logger.info(
				{ broadcastId: id, listSlug: request.listSlug, processed },
				"broadcast completed",
			);

			return record;
		} catch (err) {
			record.status = "failed";
			await this.updateProgressStatus(progressKey, "failed");
			await this.redis.del(lockKey);

			this.logger.error(
				{ broadcastId: id, listSlug: request.listSlug, error: String(err) },
				"broadcast failed",
			);

			throw err;
		}
	}

	async resumeBroadcast(broadcastId: string): Promise<BroadcastRecord | null> {
		const progressKey = broadcastProgressKey(broadcastId);
		const progress = await this.redis.hgetall(progressKey);

		if (!progress.status || progress.status !== "running") {
			return null;
		}

		const listSlug = progress.listSlug;
		const event = progress.event;
		const payloadStr = progress.payload;
		const startedAtStr = progress.startedAt;
		const totalStr = progress.total;
		if (!listSlug || !event || !payloadStr || !startedAtStr || !totalStr) {
			await this.updateProgressStatus(progressKey, "failed");
			return null;
		}

		const request: BroadcastRequest = {
			listSlug,
			event,
			payload: JSON.parse(payloadStr),
		};

		const list = await this.listRepository.findBySlug(request.listSlug);
		if (!list || list.archivedAt) {
			await this.updateProgressStatus(progressKey, "failed");
			return null;
		}

		const lockKey = broadcastLockKey(broadcastId);
		const lockResult = await this.redis.set(lockKey, "1", "NX", "EX", LOCK_TTL_SECONDS);
		if (lockResult !== "OK") {
			return null;
		}

		const resumeCursor = progress.offset || undefined;
		const alreadyProcessed = Number.parseInt(progress.processed ?? "0", 10);

		this.logger.info(
			{ broadcastId, listSlug: request.listSlug, resumeFrom: resumeCursor, alreadyProcessed },
			"resuming broadcast",
		);

		let processed = alreadyProcessed;
		let cursor = resumeCursor;

		try {
			do {
				const page = await this.listMemberRepository.listByList(list.id, {
					status: "confirmed",
					limit: BATCH_SIZE,
					cursor,
				});

				for (const member of page.items) {
					try {
						await this.send({
							event: request.event,
							subscriberId: member.subscriberId,
							payload: request.payload,
						});
					} catch (sendErr) {
						this.logger.warn(
							{ broadcastId, subscriberId: member.subscriberId, error: String(sendErr) },
							"broadcast send failed for member (resume)",
						);
					}
					processed++;
				}

				cursor = page.cursor;
				await this.redis.hset(progressKey, "offset", cursor ?? "");
				await this.redis.hset(progressKey, "processed", String(processed));

				if (page.hasMore) {
					await new Promise((resolve) => setImmediate(resolve));
				}
			} while (cursor);

			await this.updateProgressStatus(progressKey, "completed");
			await this.redis.del(lockKey);

			this.logger.info(
				{ broadcastId, listSlug: request.listSlug, processed },
				"broadcast resume completed",
			);

			return {
				id: broadcastId,
				listSlug: request.listSlug,
				event: request.event,
				payload: request.payload,
				status: "completed",
				createdAt: new Date(startedAtStr),
				startedAt: new Date(startedAtStr),
				completedAt: new Date(),
				memberCount: Number.parseInt(totalStr, 10),
				processedCount: processed,
			};
		} catch (err) {
			await this.updateProgressStatus(progressKey, "failed");
			await this.redis.del(lockKey);
			throw err;
		}
	}

	private async updateProgressStatus(progressKey: string, status: BroadcastStatus): Promise<void> {
		await this.redis.hset(progressKey, "status", status);
	}
}
