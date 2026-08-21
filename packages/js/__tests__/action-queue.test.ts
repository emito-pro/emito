import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionQueue } from "../src/queue/action-queue.js";
import type { ActionType, QueuedAction } from "../src/queue/action-queue.js";
import { MemoryStorageAdapter } from "../src/storage/memory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueue(options?: ConstructorParameters<typeof ActionQueue>[0]): ActionQueue {
	return new ActionQueue(options);
}

function makeReplayHandler(results: Array<"success" | "fail"> = []): ReturnType<typeof vi.fn> {
	let callIndex = 0;
	return vi.fn().mockImplementation(() => {
		const outcome = results[callIndex++];
		if (outcome === "fail") {
			return Promise.reject(new Error("replay failed"));
		}
		return Promise.resolve();
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActionQueue", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("enqueue", () => {
		it("adds an action to the queue", async () => {
			const q = makeQueue();
			await q.enqueue("markAsRead", ["ntf_1"]);
			expect(q.size).toBe(1);
		});

		it("enqueued action has correct type and args", async () => {
			const q = makeQueue();
			await q.enqueue("archive", ["ntf_5"]);
			const actions = q.getActions();
			expect(actions[0]!.type).toBe("archive");
			expect(actions[0]!.args).toEqual(["ntf_5"]);
		});

		it("enqueued action has an id and createdAt timestamp", async () => {
			const q = makeQueue();
			await q.enqueue("markAsRead", ["ntf_1"]);
			const action = q.getActions()[0]!;
			expect(typeof action.id).toBe("string");
			expect(action.id.length).toBeGreaterThan(0);
			expect(typeof action.createdAt).toBe("string");
			expect(() => new Date(action.createdAt)).not.toThrow();
		});

		it("queues multiple actions in order", async () => {
			const q = makeQueue();
			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.enqueue("archive", ["ntf_2"]);
			await q.enqueue("markAllAsRead", []);

			const actions = q.getActions();
			expect(actions).toHaveLength(3);
			expect(actions[0]!.type).toBe("markAsRead");
			expect(actions[1]!.type).toBe("archive");
			expect(actions[2]!.type).toBe("markAllAsRead");
		});

		it("respects maxSize — drops oldest action when at capacity", async () => {
			const q = makeQueue({ maxSize: 3 });
			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.enqueue("archive", ["ntf_2"]);
			await q.enqueue("markAsUnread", ["ntf_3"]);
			// Queue is full — next enqueue drops ntf_1
			await q.enqueue("subscribe", ["topic_a"]);

			expect(q.size).toBe(3);
			const actions = q.getActions();
			expect(actions[0]!.type).toBe("archive"); // ntf_1 was dropped
			expect(actions[2]!.type).toBe("subscribe");
		});

		it("default maxSize is 100 (does not drop before 100)", async () => {
			const q = makeQueue();
			for (let i = 0; i < 100; i++) {
				await q.enqueue("markAsRead", [`ntf_${i}`]);
			}
			expect(q.size).toBe(100);

			// 101st action should drop the oldest
			await q.enqueue("archive", ["ntf_overflow"]);
			expect(q.size).toBe(100);
		});

		it("all ActionType variants are accepted", async () => {
			const q = makeQueue();
			const types: ActionType[] = [
				"markAsRead",
				"markAsUnread",
				"archive",
				"unarchive",
				"snooze",
				"markAllAsRead",
				"preferenceUpdate",
				"preferenceReset",
				"subscribe",
				"unsubscribe",
			];
			for (const type of types) {
				await q.enqueue(type, []);
			}
			expect(q.size).toBe(types.length);
		});
	});

	describe("flush — success path", () => {
		it("calls replayHandler for each queued action in order", async () => {
			const q = makeQueue();
			const handler = vi.fn().mockResolvedValue(undefined);
			q.onReplay(handler);

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.enqueue("archive", ["ntf_2"]);
			await q.flush();

			expect(handler).toHaveBeenCalledTimes(2);
			const [firstCall, secondCall] = handler.mock.calls as [QueuedAction[], QueuedAction[]];
			expect(firstCall[0]!.type).toBe("markAsRead");
			expect(secondCall[0]!.type).toBe("archive");
		});

		it("empties the queue after successful flush", async () => {
			const q = makeQueue();
			q.onReplay(vi.fn().mockResolvedValue(undefined));

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.enqueue("markAsUnread", ["ntf_2"]);
			await q.flush();

			expect(q.size).toBe(0);
		});

		it("does nothing when queue is empty", async () => {
			const q = makeQueue();
			const handler = vi.fn().mockResolvedValue(undefined);
			q.onReplay(handler);

			await q.flush();

			expect(handler).not.toHaveBeenCalled();
		});

		it("does nothing when no replayHandler is registered", async () => {
			const q = makeQueue();
			await q.enqueue("markAsRead", ["ntf_1"]);

			// Should not throw
			await expect(q.flush()).resolves.toBeUndefined();
			// Queue is unchanged because there's no handler to consume it
		});

		it("isFlushing is false after successful flush", async () => {
			const q = makeQueue();
			q.onReplay(vi.fn().mockResolvedValue(undefined));

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.flush();

			expect(q.isFlushing).toBe(false);
		});
	});

	describe("flush — retry and failure", () => {
		it("retries a failed action once before discarding", async () => {
			const q = makeQueue();
			// fail, fail — should be retried once
			const handler = makeReplayHandler(["fail", "fail"]);
			q.onReplay(handler);

			const errorHandler = vi.fn();
			q.onError(errorHandler);

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.flush();

			// Called twice (original + 1 retry)
			expect(handler).toHaveBeenCalledTimes(2);
			// Discarded with error
			expect(errorHandler).toHaveBeenCalledTimes(1);
			expect(errorHandler.mock.calls[0]![0]).toBeInstanceOf(Error);
			expect(errorHandler.mock.calls[0]![1]).toMatchObject({ type: "markAsRead" });
		});

		it("discards failed actions — does not leave them in the queue", async () => {
			const q = makeQueue();
			const handler = makeReplayHandler(["fail", "fail"]);
			q.onReplay(handler);
			q.onError(vi.fn());

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.flush();

			expect(q.size).toBe(0);
		});

		it("continues flushing remaining actions after a failed action", async () => {
			const q = makeQueue();
			// Action 1: fail both attempts; Action 2: success; Action 3: success
			const handler = makeReplayHandler(["fail", "fail", "success", "success"]);
			q.onReplay(handler);

			const errorHandler = vi.fn();
			q.onError(errorHandler);

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.enqueue("archive", ["ntf_2"]);
			await q.enqueue("markAllAsRead", []);
			await q.flush();

			// ntf_1 failed (2 calls), ntf_2 success (1 call), markAllAsRead success (1 call)
			expect(handler).toHaveBeenCalledTimes(4);
			expect(errorHandler).toHaveBeenCalledTimes(1);
			expect(q.size).toBe(0);
		});

		it("error handler receives Error instance and the failed action", async () => {
			const q = makeQueue();
			const replayError = new Error("server 503");
			const handler = vi.fn().mockRejectedValue(replayError);
			q.onReplay(handler);

			const errorHandler = vi.fn();
			q.onError(errorHandler);

			await q.enqueue("archive", ["ntf_9"]);
			await q.flush();

			expect(errorHandler).toHaveBeenCalledWith(
				replayError,
				expect.objectContaining({ type: "archive", args: ["ntf_9"] }),
			);
		});

		it("error handler receives an Error even when replay throws a non-Error", async () => {
			const q = makeQueue();
			const handler = vi.fn().mockRejectedValue("raw string error");
			q.onReplay(handler);

			const errorHandler = vi.fn();
			q.onError(errorHandler);

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.flush();

			expect(errorHandler.mock.calls[0]![0]).toBeInstanceOf(Error);
		});

		it("does not crash when errorHandler is not registered", async () => {
			const q = makeQueue();
			const handler = makeReplayHandler(["fail", "fail"]);
			q.onReplay(handler);
			// No onError registered

			await q.enqueue("markAsRead", ["ntf_1"]);
			await expect(q.flush()).resolves.toBeUndefined();
		});

		it("isFlushing is false even after flush with errors", async () => {
			const q = makeQueue();
			const handler = makeReplayHandler(["fail", "fail"]);
			q.onReplay(handler);
			q.onError(vi.fn());

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.flush();

			expect(q.isFlushing).toBe(false);
		});
	});

	describe("flush — concurrency", () => {
		it("does not start a second flush while one is in progress", async () => {
			const q = makeQueue();

			// Slow replay handler
			let resolveReplay!: () => void;
			const replayPromise = new Promise<void>((res) => (resolveReplay = res));
			const handler = vi.fn().mockReturnValue(replayPromise);
			q.onReplay(handler);

			await q.enqueue("markAsRead", ["ntf_1"]);

			const flush1 = q.flush();
			const flush2 = q.flush(); // Should be a no-op

			resolveReplay();
			await Promise.all([flush1, flush2]);

			// Handler only called once — second flush was skipped
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe("clear", () => {
		it("removes all queued actions", async () => {
			const q = makeQueue();
			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.enqueue("archive", ["ntf_2"]);
			await q.clear();

			expect(q.size).toBe(0);
			expect(q.getActions()).toHaveLength(0);
		});

		it("safe to call on an empty queue", async () => {
			const q = makeQueue();
			await expect(q.clear()).resolves.toBeUndefined();
		});
	});

	describe("restore — storage persistence", () => {
		it("loads previously persisted actions from storage", async () => {
			const storage = new MemoryStorageAdapter();
			const q1 = makeQueue({ storage });

			await q1.enqueue("markAsRead", ["ntf_1"]);
			await q1.enqueue("archive", ["ntf_2"]);

			// Create a new queue that restores from same storage
			const q2 = makeQueue({ storage });
			await q2.restore();

			expect(q2.size).toBe(2);
			const actions = q2.getActions();
			expect(actions[0]!.type).toBe("markAsRead");
			expect(actions[1]!.type).toBe("archive");
		});

		it("starts fresh when storage is empty", async () => {
			const storage = new MemoryStorageAdapter();
			const q = makeQueue({ storage });
			await q.restore();

			expect(q.size).toBe(0);
		});

		it("starts fresh when storage contains corrupted data", async () => {
			const storage = new MemoryStorageAdapter();
			await storage.setItem("emito:action-queue", "not-valid-json{{{");

			const q = makeQueue({ storage });
			await q.restore();

			expect(q.size).toBe(0);
		});

		it("does not throw when no storage is configured", async () => {
			const q = makeQueue(); // no storage
			await expect(q.restore()).resolves.toBeUndefined();
		});

		it("persists to storage on enqueue", async () => {
			const storage = new MemoryStorageAdapter();
			const q = makeQueue({ storage });

			await q.enqueue("markAsRead", ["ntf_1"]);

			const raw = await storage.getItem("emito:action-queue");
			expect(raw).not.toBeNull();
			const parsed = JSON.parse(raw!) as QueuedAction[];
			expect(parsed).toHaveLength(1);
			expect(parsed[0]!.type).toBe("markAsRead");
		});

		it("persists remaining queue to storage after flush", async () => {
			const storage = new MemoryStorageAdapter();
			const q = makeQueue({ storage });

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.enqueue("archive", ["ntf_2"]);

			q.onReplay(vi.fn().mockResolvedValue(undefined));
			await q.flush();

			const raw = await storage.getItem("emito:action-queue");
			const parsed = JSON.parse(raw!) as QueuedAction[];
			expect(parsed).toHaveLength(0);
		});

		it("clears storage on clear()", async () => {
			const storage = new MemoryStorageAdapter();
			const q = makeQueue({ storage });

			await q.enqueue("markAsRead", ["ntf_1"]);
			await q.clear();

			const raw = await storage.getItem("emito:action-queue");
			// Storage should either be null or contain an empty array
			if (raw !== null) {
				const parsed = JSON.parse(raw) as QueuedAction[];
				expect(parsed).toHaveLength(0);
			}
		});
	});

	describe("getActions snapshot", () => {
		it("returns a readonly snapshot of the queue", async () => {
			const q = makeQueue();
			await q.enqueue("markAsRead", ["ntf_1"]);
			const snapshot = q.getActions();
			expect(snapshot).toHaveLength(1);
			expect(snapshot[0]!.type).toBe("markAsRead");
		});
	});
});
