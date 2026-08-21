/**
 * Integration tests for the {@link DrizzlePushTokenRepository} subscriber-scoped
 * reads/writes that back the "Channels" tab, against a real PostgreSQL.
 *
 *  - `listBySubscriber` returns every token of one subscriber, newest-first, and
 *    `[]` for an unknown subscriber.
 *  - `deactivateById` flips one token to inactive *scoped to its owner*, so a
 *    cross-subscriber id is a no-op (`false`) and never touches another's device.
 *  - `deactivateByToken` (pre-existing) is re-asserted to guard against regression.
 *
 * Row isolation between tests comes from the per-test TRUNCATE in `../test-setup.ts`.
 *
 * @module __tests__/repositories/push-token-subscriber
 */
import { describe, expect, it } from "vitest";
import { DrizzlePushTokenRepository } from "../../src/repositories/drizzle-push-token-repository";
import { emito_push_tokens } from "../../src/schema/push-tokens";
import { dbAvailable, getDb, setupAdminTestDb, tick } from "./admin-test-db";

setupAdminTestDb();

/** Insert a push token row, returning its generated id. */
async function insertToken(
	subscriberId: string,
	token: string,
	overrides: Partial<{ platform: string; deviceName: string | null; active: boolean }> = {},
): Promise<string> {
	const db = getDb();
	const [row] = await db
		.insert(emito_push_tokens)
		.values({
			subscriberId,
			token,
			platform: overrides.platform ?? "ios",
			deviceName: overrides.deviceName ?? "iPhone",
			active: overrides.active ?? true,
		})
		.returning({ id: emito_push_tokens.id });
	if (!row) throw new Error("failed to insert push token");
	return row.id;
}

describe("DrizzlePushTokenRepository.listBySubscriber", () => {
	it("returns a subscriber's tokens newest-first", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzlePushTokenRepository(getDb());
		await insertToken("sub_1", "tok-a", { platform: "ios", deviceName: "iPhone" });
		await tick();
		await insertToken("sub_1", "tok-b", { platform: "android", deviceName: "Pixel", active: false });
		await insertToken("sub_2", "tok-c"); // different subscriber

		const tokens = await repo.listBySubscriber("sub_1");
		expect(tokens).toHaveLength(2);
		// Newest-first: tok-b was inserted after tok-a.
		expect(tokens[0]?.token).toBe("tok-b");
		expect(tokens[0]).toMatchObject({ subscriberId: "sub_1", platform: "android", active: false });
		expect(tokens[1]).toMatchObject({ token: "tok-a", deviceName: "iPhone", active: true });
		expect(tokens[0]?.createdAt).toBeInstanceOf(Date);
	});

	it("returns [] for a subscriber with no tokens", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzlePushTokenRepository(getDb());
		expect(await repo.listBySubscriber("sub_unknown")).toEqual([]);
	});
});

describe("DrizzlePushTokenRepository.deactivateById", () => {
	it("deactivates one token scoped to its owner and reports true", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzlePushTokenRepository(getDb());
		const id = await insertToken("sub_1", "tok-a");

		expect(await repo.deactivateById(id, "sub_1")).toBe(true);
		const [token] = await repo.listBySubscriber("sub_1");
		expect(token?.active).toBe(false);
	});

	it("is a no-op (false) for a token that belongs to another subscriber", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzlePushTokenRepository(getDb());
		const id = await insertToken("sub_1", "tok-a");

		expect(await repo.deactivateById(id, "sub_other")).toBe(false);
		// The real owner's token is untouched.
		const [token] = await repo.listBySubscriber("sub_1");
		expect(token?.active).toBe(true);
	});

	it("is a no-op (false) for an unknown id", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzlePushTokenRepository(getDb());
		expect(await repo.deactivateById("ptk_nope", "sub_1")).toBe(false);
	});
});

describe("DrizzlePushTokenRepository.deactivateByToken", () => {
	it("deactivates every row carrying the token (regression guard)", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzlePushTokenRepository(getDb());
		await insertToken("sub_1", "shared-token");

		await repo.deactivateByToken("shared-token");
		const [token] = await repo.listBySubscriber("sub_1");
		expect(token?.active).toBe(false);
	});
});
