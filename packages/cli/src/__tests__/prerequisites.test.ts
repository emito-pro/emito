import { describe, expect, it, vi } from "vitest";
import { checkPrerequisites } from "../detect/prerequisites.js";

describe("checkPrerequisites", () => {
	it("reports both urls missing when env is empty", async () => {
		const result = await checkPrerequisites({});
		expect(result).toEqual({
			databaseUrl: null,
			redisUrl: null,
			databaseReachable: false,
			redisReachable: false,
			// A missing URL is not a connection failure — there is nothing to report.
			databaseError: undefined,
			redisError: undefined,
		});
	});

	it("does not attempt a connection when a url is missing", async () => {
		const result = await checkPrerequisites({ DATABASE_URL: "postgres://x/y" });
		expect(result.redisUrl).toBeNull();
		expect(result.redisReachable).toBe(false);
		expect(result.redisError).toBeUndefined();
	});

	it("captures the underlying connection error instead of swallowing it", async () => {
		// Port 1 is reserved and never listening, so both pings fail fast for a
		// reason we can actually surface to the user.
		const result = await checkPrerequisites({
			DATABASE_URL: "postgres://user:pw@127.0.0.1:1/nope",
			REDIS_URL: "redis://127.0.0.1:1",
		});

		expect(result.databaseReachable).toBe(false);
		expect(result.redisReachable).toBe(false);
		expect(result.databaseError).toBeTypeOf("string");
		expect(result.databaseError).not.toBe("");
		expect(result.redisError).toBeTypeOf("string");
		expect(result.redisError).not.toBe("");
	});
});
