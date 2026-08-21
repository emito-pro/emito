/**
 * Unit tests for the broadcast subsystem: BroadcastService (execute + resume)
 * and the broadcast scheduler (schedule, poll, crash recovery, lifecycle).
 * Runs against the in-memory list repositories and the mock Redis.
 */

import type { SendParams, SendResult } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BroadcastService,
	createBroadcastScheduler,
} from "../src/broadcast";
import type { Logger } from "../src/observability/logger";
import type { ListRepository } from "../src/repositories/list-repository";
import { InMemoryListMemberRepository } from "../src/repositories/in-memory/in-memory-list-member-repository";
import { InMemoryListRepository } from "../src/repositories/in-memory/in-memory-list-repository";
import type { ListMemberRecord } from "../src/repositories/types";
import { createMockRedis, type MockRedis } from "./helpers/mock-redis";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
		level: "silent" as const,
	};
}

function asLogger(mock: ReturnType<typeof createMockLogger>): Logger {
	return mock as unknown as Logger;
}

let memberSeq = 0;

function seedConfirmedMembers(
	memberRepo: InMemoryListMemberRepository,
	listId: string,
	count: number,
): void {
	for (let i = 0; i < count; i++) {
		memberSeq++;
		const record: ListMemberRecord = {
			id: `lmb_${String(memberSeq).padStart(6, "0")}`,
			subscriberId: `sub_${String(memberSeq).padStart(6, "0")}`,
			listId,
			status: "confirmed",
			subscribedAt: new Date(2026, 0, 1, 0, 0, memberSeq),
			confirmedAt: new Date(2026, 0, 1, 0, 0, memberSeq),
			createdAt: new Date(2026, 0, 1, 0, 0, memberSeq),
		};
		memberRepo.seed(record);
	}
}

function createSendSpy(): {
	send: (params: SendParams) => Promise<SendResult>;
	calls: SendParams[];
} {
	const calls: SendParams[] = [];
	const send = vi.fn(async (params: SendParams): Promise<SendResult> => {
		calls.push(params);
		return {
			notificationId: `ntf_${calls.length}`,
			status: "queued",
			deliveries: [],
		} as unknown as SendResult;
	});
	return { send, calls };
}

interface Harness {
	listRepo: InMemoryListRepository;
	memberRepo: InMemoryListMemberRepository;
	redis: MockRedis;
	logger: ReturnType<typeof createMockLogger>;
	service: BroadcastService;
	sendCalls: SendParams[];
	send: (params: SendParams) => Promise<SendResult>;
}

function makeHarness(
	overrides: {
		send?: (params: SendParams) => Promise<SendResult>;
		listRepository?: ListRepository;
	} = {},
): Harness {
	const listRepo = new InMemoryListRepository();
	const memberRepo = new InMemoryListMemberRepository();
	const redis = createMockRedis();
	const logger = createMockLogger();
	const spy = createSendSpy();
	const send = overrides.send ?? spy.send;

	const service = new BroadcastService({
		listRepository: overrides.listRepository ?? listRepo,
		listMemberRepository: memberRepo,
		redis,
		send,
		logger: asLogger(logger),
	});

	return {
		listRepo,
		memberRepo,
		redis,
		logger,
		service,
		sendCalls: spy.calls,
		send,
	};
}

beforeEach(() => {
	memberSeq = 0;
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// BroadcastService.executeBroadcast — validation
// ---------------------------------------------------------------------------

describe("BroadcastService.executeBroadcast — validation", () => {
	it("throws when the list does not exist", async () => {
		const h = makeHarness();
		await expect(
			h.service.executeBroadcast({
				listSlug: "missing",
				event: "promo",
				payload: {},
			}),
		).rejects.toThrow(/not found/);
	});

	it("throws when the list is archived", async () => {
		const archivedList = {
			id: "lst_arch",
			name: "Archived",
			slug: "archived",
			optinType: "single" as const,
			visibility: "private" as const,
			memberCount: 0,
			archivedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const listRepository: ListRepository = {
			create: vi.fn(),
			findById: vi.fn(),
			findBySlug: vi.fn().mockResolvedValue(archivedList),
			list: vi.fn(),
			update: vi.fn(),
			archive: vi.fn(),
			updateMemberCount: vi.fn(),
		};
		const h = makeHarness({ listRepository });
		await expect(
			h.service.executeBroadcast({
				listSlug: "archived",
				event: "promo",
				payload: {},
			}),
		).rejects.toThrow(/archived/);
	});

	it("throws when the list has no confirmed members", async () => {
		const h = makeHarness();
		const list = await h.listRepo.create({ name: "Empty", slug: "empty" });
		expect(list.id).toBeTruthy();
		await expect(
			h.service.executeBroadcast({
				listSlug: "empty",
				event: "promo",
				payload: {},
			}),
		).rejects.toThrow(/no confirmed members/);
	});

	it("throws when a broadcast with the same id is already locked", async () => {
		const h = makeHarness();
		const list = await h.listRepo.create({ name: "Promo", slug: "promo" });
		seedConfirmedMembers(h.memberRepo, list.id, 1);

		// Pre-acquire the lock for a fixed id.
		await h.redis.set("emito:broadcast:lock:fixed-id", "1", "NX", "EX", 300);

		await expect(
			h.service.executeBroadcast(
				{ listSlug: "promo", event: "promo", payload: {} },
				"fixed-id",
			),
		).rejects.toThrow(/already running/);
	});
});

// ---------------------------------------------------------------------------
// BroadcastService.executeBroadcast — happy path
// ---------------------------------------------------------------------------

describe("BroadcastService.executeBroadcast — execution", () => {
	it("sends to every confirmed member and completes", async () => {
		const h = makeHarness();
		const list = await h.listRepo.create({ name: "News", slug: "news" });
		seedConfirmedMembers(h.memberRepo, list.id, 3);

		const record = await h.service.executeBroadcast(
			{ listSlug: "news", event: "weekly", payload: { foo: "bar" } },
			"bc-1",
		);

		expect(record.status).toBe("completed");
		expect(record.processedCount).toBe(3);
		expect(record.memberCount).toBe(3);
		expect(record.completedAt).toBeInstanceOf(Date);
		expect(h.sendCalls).toHaveLength(3);
		expect(h.sendCalls[0]!.event).toBe("weekly");
		expect(h.sendCalls[0]!.payload).toEqual({ foo: "bar" });

		// Progress hash reflects completion and the lock has been released.
		const progress = await h.redis.hgetall("emito:broadcast:progress:bc-1");
		expect(progress.status).toBe("completed");
		expect(await h.redis.get("emito:broadcast:lock:bc-1")).toBeNull();
	});

	it("paginates across batches larger than BATCH_SIZE", async () => {
		const h = makeHarness();
		const list = await h.listRepo.create({ name: "Big", slug: "big" });
		seedConfirmedMembers(h.memberRepo, list.id, 250);

		const record = await h.service.executeBroadcast(
			{ listSlug: "big", event: "weekly", payload: {} },
			"bc-big",
		);

		expect(record.processedCount).toBe(250);
		expect(h.sendCalls).toHaveLength(250);
	});

	it("generates an id when none is supplied", async () => {
		const h = makeHarness();
		const list = await h.listRepo.create({ name: "Auto", slug: "auto" });
		seedConfirmedMembers(h.memberRepo, list.id, 1);

		const record = await h.service.executeBroadcast({
			listSlug: "auto",
			event: "weekly",
			payload: {},
		});

		expect(record.id).toMatch(/[0-9a-f-]{36}/);
		expect(record.status).toBe("completed");
	});

	it("continues past individual member send failures and logs a warning", async () => {
		let n = 0;
		const send = vi.fn(async (): Promise<SendResult> => {
			n++;
			if (n === 2) throw new Error("provider boom");
			return { notificationId: `n${n}`, status: "queued", deliveries: [] } as unknown as SendResult;
		});
		const h = makeHarness({ send });
		const list = await h.listRepo.create({ name: "Resilient", slug: "resilient" });
		seedConfirmedMembers(h.memberRepo, list.id, 3);

		const record = await h.service.executeBroadcast(
			{ listSlug: "resilient", event: "weekly", payload: {} },
			"bc-warn",
		);

		// All three are counted as processed even though one send threw.
		expect(record.status).toBe("completed");
		expect(record.processedCount).toBe(3);
		expect(h.logger.warn).toHaveBeenCalledTimes(1);
		expect(h.logger.warn.mock.calls[0]![1]).toMatch(/broadcast send failed/);
	});
});

// ---------------------------------------------------------------------------
// BroadcastService.resumeBroadcast
// ---------------------------------------------------------------------------

describe("BroadcastService.resumeBroadcast", () => {
	async function seedRunningProgress(
		h: Harness,
		id: string,
		fields: Record<string, string>,
	): Promise<void> {
		const key = `emito:broadcast:progress:${id}`;
		for (const [field, value] of Object.entries(fields)) {
			await h.redis.hset(key, field, value);
		}
	}

	it("returns null when there is no running progress", async () => {
		const h = makeHarness();
		expect(await h.service.resumeBroadcast("nope")).toBeNull();
	});

	it("returns null and marks failed when progress fields are incomplete", async () => {
		const h = makeHarness();
		await seedRunningProgress(h, "incomplete", { status: "running" });

		expect(await h.service.resumeBroadcast("incomplete")).toBeNull();
		const progress = await h.redis.hgetall("emito:broadcast:progress:incomplete");
		expect(progress.status).toBe("failed");
	});

	it("returns null and marks failed when the list is gone", async () => {
		const h = makeHarness();
		await seedRunningProgress(h, "gone", {
			status: "running",
			listSlug: "vanished",
			event: "weekly",
			payload: "{}",
			startedAt: new Date().toISOString(),
			total: "5",
		});

		expect(await h.service.resumeBroadcast("gone")).toBeNull();
		const progress = await h.redis.hgetall("emito:broadcast:progress:gone");
		expect(progress.status).toBe("failed");
	});

	it("returns null when the lock is already held by another worker", async () => {
		const h = makeHarness();
		const list = await h.listRepo.create({ name: "Locked", slug: "locked" });
		seedConfirmedMembers(h.memberRepo, list.id, 2);
		await seedRunningProgress(h, "held", {
			status: "running",
			listSlug: "locked",
			event: "weekly",
			payload: "{}",
			startedAt: new Date().toISOString(),
			total: "2",
		});
		await h.redis.set("emito:broadcast:lock:held", "1", "NX", "EX", 300);

		expect(await h.service.resumeBroadcast("held")).toBeNull();
	});

	it("resumes from the recorded offset and completes", async () => {
		const h = makeHarness();
		const list = await h.listRepo.create({ name: "Resumable", slug: "resumable" });
		seedConfirmedMembers(h.memberRepo, list.id, 4);
		await seedRunningProgress(h, "resume-1", {
			status: "running",
			listSlug: "resumable",
			event: "weekly",
			payload: JSON.stringify({ k: "v" }),
			startedAt: new Date("2026-01-02T00:00:00Z").toISOString(),
			total: "4",
			processed: "1",
		});

		const record = await h.service.resumeBroadcast("resume-1");

		expect(record).not.toBeNull();
		expect(record!.status).toBe("completed");
		expect(record!.memberCount).toBe(4);
		// processed seed (1) plus 4 confirmed members iterated on resume.
		expect(record!.processedCount).toBe(5);
		expect(h.sendCalls).toHaveLength(4);
		expect(await h.redis.get("emito:broadcast:lock:resume-1")).toBeNull();
		const progress = await h.redis.hgetall("emito:broadcast:progress:resume-1");
		expect(progress.status).toBe("completed");
	});

	it("logs a warning when a member send fails during resume but still completes", async () => {
		const send = vi.fn(async (): Promise<SendResult> => {
			throw new Error("down");
		});
		const h = makeHarness({ send });
		const list = await h.listRepo.create({ name: "Flaky", slug: "flaky" });
		seedConfirmedMembers(h.memberRepo, list.id, 2);
		await seedRunningProgress(h, "resume-warn", {
			status: "running",
			listSlug: "flaky",
			event: "weekly",
			payload: "{}",
			startedAt: new Date().toISOString(),
			total: "2",
		});

		const record = await h.service.resumeBroadcast("resume-warn");
		expect(record!.status).toBe("completed");
		expect(h.logger.warn).toHaveBeenCalled();
		expect(h.logger.warn.mock.calls[0]![1]).toMatch(/resume/);
	});
});

// ---------------------------------------------------------------------------
// createBroadcastScheduler
// ---------------------------------------------------------------------------

describe("createBroadcastScheduler", () => {
	function makeScheduler(serviceOverride?: Partial<BroadcastService>) {
		const redis = createMockRedis();
		const logger = createMockLogger();
		const broadcastService = {
			executeBroadcast: vi.fn().mockResolvedValue(undefined),
			resumeBroadcast: vi.fn().mockResolvedValue(undefined),
			...serviceOverride,
		} as unknown as BroadcastService;
		const scheduler = createBroadcastScheduler({
			redis,
			broadcastService,
			logger: asLogger(logger),
			pollIntervalMs: 10,
		});
		return { redis, logger, broadcastService, scheduler };
	}

	afterEach(() => {
		vi.useRealTimers();
	});

	it("schedule stores the request in the sorted set", async () => {
		const { scheduler, redis } = makeScheduler();
		const scheduledAt = new Date("2026-06-10T00:00:00Z");
		await scheduler.schedule(
			{ listSlug: "news", event: "weekly", payload: {}, scheduledAt },
			"bc-sched",
		);

		const members = await redis.zrangebyscore("emito:broadcast:scheduled", "-inf", "+inf");
		expect(members).toHaveLength(1);
		const parsed = JSON.parse(members[0]!) as { id: string };
		expect(parsed.id).toBe("bc-sched");
	});

	it("schedule throws when scheduledAt is missing", async () => {
		const { scheduler } = makeScheduler();
		await expect(
			scheduler.schedule({ listSlug: "news", event: "weekly", payload: {} }, "x"),
		).rejects.toThrow(/scheduledAt is required/);
	});

	it("polls and executes a due broadcast on the interval", async () => {
		vi.useFakeTimers();
		const { scheduler, redis, broadcastService } = makeScheduler();

		// A broadcast already due in the past.
		const past = Date.now() - 1000;
		await redis.zadd(
			"emito:broadcast:scheduled",
			past,
			JSON.stringify({ id: "due-1", request: { listSlug: "news", event: "weekly", payload: {} } }),
		);

		await scheduler.start();
		await vi.advanceTimersByTimeAsync(15);
		await scheduler.stop();

		expect(broadcastService.executeBroadcast).toHaveBeenCalledTimes(1);
		expect(broadcastService.executeBroadcast).toHaveBeenCalledWith(
			expect.objectContaining({ listSlug: "news" }),
			"due-1",
		);
		// Member is removed from the scheduled set after dispatch.
		const remaining = await redis.zrangebyscore("emito:broadcast:scheduled", "-inf", "+inf");
		expect(remaining).toHaveLength(0);
	});

	it("logs an error but keeps polling when execution rejects", async () => {
		vi.useFakeTimers();
		const { scheduler, redis, logger, broadcastService } = makeScheduler({
			executeBroadcast: vi.fn().mockRejectedValue(new Error("boom")),
		});
		await redis.zadd(
			"emito:broadcast:scheduled",
			Date.now() - 1000,
			JSON.stringify({ id: "due-err", request: { listSlug: "x", event: "e", payload: {} } }),
		);

		await scheduler.start();
		await vi.advanceTimersByTimeAsync(15);
		await scheduler.stop();

		expect(broadcastService.executeBroadcast).toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalled();
	});

	it("recovers in-flight running broadcasts on start", async () => {
		vi.useFakeTimers();
		const resumeBroadcast = vi.fn().mockResolvedValue(undefined);
		const { scheduler, redis } = makeScheduler({ resumeBroadcast });

		await redis.hset("emito:broadcast:progress:running-1", "status", "running");
		await redis.hset("emito:broadcast:progress:done-1", "status", "completed");

		await scheduler.start();
		await scheduler.stop();

		expect(resumeBroadcast).toHaveBeenCalledTimes(1);
		expect(resumeBroadcast).toHaveBeenCalledWith("running-1");
	});

	it("logs an error when crash recovery resume rejects", async () => {
		vi.useFakeTimers();
		const resumeBroadcast = vi.fn().mockRejectedValue(new Error("resume failed"));
		const { scheduler, redis, logger } = makeScheduler({ resumeBroadcast });
		await redis.hset("emito:broadcast:progress:running-2", "status", "running");

		await scheduler.start();
		await scheduler.stop();

		expect(resumeBroadcast).toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalled();
	});

	it("stop is a no-op when never started", async () => {
		const { scheduler } = makeScheduler();
		await expect(scheduler.stop()).resolves.toBeUndefined();
	});
});
