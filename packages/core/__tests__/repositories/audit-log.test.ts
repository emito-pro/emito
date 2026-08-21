import { EmitoError } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../src/index";
import { InMemoryAuditLogRepository } from "../../src/index";

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
	return {
		actorUserId: "user_admin",
		actorKind: "user",
		action: "subscriber.update",
		resourceType: "subscriber",
		resourceId: "sub_1",
		severity: "medium",
		requestId: "req_1",
		ip: "10.0.0.1",
		...overrides,
	};
}

describe("InMemoryAuditLogRepository", () => {
	let repo: InMemoryAuditLogRepository;

	beforeEach(() => {
		repo = new InMemoryAuditLogRepository();
	});

	it("create persists with generated id, createdAt, and null-defaulted optionals", async () => {
		const record = await repo.create(entry());
		expect(record.id).toMatch(/^aud_mem_/);
		expect(record.createdAt).toBeInstanceOf(Date);
		expect(record.beforeState).toBeNull();
		expect(record.afterState).toBeNull();
		expect(record.userAgent).toBeNull();
		expect(record.apiKeyId).toBeNull();
		expect(record.metadata).toEqual({});
	});

	it("create preserves supplied snapshots and metadata", async () => {
		const record = await repo.create(
			entry({
				beforeState: { name: "old" },
				afterState: { name: "new" },
				userAgent: "curl/8",
				apiKeyId: "apk_1",
				metadata: { reason: "gdpr" },
			}),
		);
		expect(record.beforeState).toEqual({ name: "old" });
		expect(record.afterState).toEqual({ name: "new" });
		expect(record.metadata).toEqual({ reason: "gdpr" });
	});

	it("create accepts a (ignored) transaction handle without throwing", async () => {
		const record = await repo.create(entry(), { fake: "tx" });
		expect(record.id).toBeDefined();
	});

	it("findById returns the record or null", async () => {
		const created = await repo.create(entry());
		expect(await repo.findById(created.id)).toEqual(created);
		expect(await repo.findById("aud_missing")).toBeNull();
	});

	it("list returns newest-first with accurate total and null cursor on the last page", async () => {
		await repo.create(entry({ action: "a1" }));
		await new Promise((r) => setTimeout(r, 2));
		await repo.create(entry({ action: "a2" }));

		const page = await repo.list({ limit: 50 });
		expect(page.total).toBe(2);
		expect(page.hasMore).toBe(false);
		expect(page.cursor).toBeNull();
		expect(page.items[0].action).toBe("a2");
		expect(page.items[1].action).toBe("a1");
	});

	it("list paginates at the cursor boundary without dropping or duplicating rows", async () => {
		for (let i = 0; i < 5; i++) {
			await repo.create(entry({ action: `a${i}` }));
			await new Promise((r) => setTimeout(r, 2));
		}

		const first = await repo.list({ limit: 2 });
		expect(first.items).toHaveLength(2);
		expect(first.hasMore).toBe(true);
		expect(first.total).toBe(5);
		expect(first.cursor).not.toBeNull();

		const second = await repo.list({ limit: 2, cursor: first.cursor });
		expect(second.items).toHaveLength(2);
		expect(second.total).toBe(5);

		const third = await repo.list({ limit: 2, cursor: second.cursor });
		expect(third.items).toHaveLength(1);
		expect(third.hasMore).toBe(false);
		expect(third.cursor).toBeNull();

		const seen = [...first.items, ...second.items, ...third.items].map((r) => r.id);
		expect(new Set(seen).size).toBe(5);
	});

	it("list filters by actor (case-insensitive substring), resourceType, severity, and action", async () => {
		await repo.create(entry({ actorUserId: "Alice", action: "x", severity: "high" }));
		await repo.create(entry({ actorUserId: "bob", action: "y", severity: "low" }));

		expect((await repo.list({ limit: 50, filters: { actor: "ali" } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { severity: "high" } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { action: "y" } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { resourceType: "subscriber" } })).total).toBe(2);
		expect((await repo.list({ limit: 50, filters: { resourceId: "sub_1" } })).total).toBe(2);
	});

	it("list filters by from/to time bounds inclusively", async () => {
		const record = await repo.create(entry());
		const before = new Date(record.createdAt.getTime() - 1000);
		const after = new Date(record.createdAt.getTime() + 1000);

		expect((await repo.list({ limit: 50, filters: { from: before } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { to: after } })).total).toBe(1);
		expect((await repo.list({ limit: 50, filters: { from: after } })).total).toBe(0);
		expect((await repo.list({ limit: 50, filters: { to: before } })).total).toBe(0);
	});

	it("list throws CURSOR_INVALID on a corrupt cursor", async () => {
		await expect(repo.list({ limit: 10, cursor: "not-base64-date" })).rejects.toBeInstanceOf(
			EmitoError,
		);
	});

	it("clear empties the store", async () => {
		await repo.create(entry());
		repo.clear();
		expect((await repo.list({ limit: 10 })).total).toBe(0);
	});
});
