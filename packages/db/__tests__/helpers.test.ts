import { pgTable, timestamp } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	ID_PREFIX,
	cursorPaginate,
	decodeCursor,
	encodeCursor,
	generateId,
	withSoftDelete,
	withTransaction,
} from "../src/index";

describe("generateId", () => {
	it("should return a string with the given prefix followed by underscore and 32 hex chars", () => {
		const id = generateId("ntf");
		expect(id).toMatch(/^ntf_[0-9a-f]{32}$/);
	});

	it("should produce unique IDs on consecutive calls", () => {
		const id1 = generateId("ntf");
		const id2 = generateId("ntf");
		expect(id1).not.toBe(id2);
	});

	it("should strip dashes from the UUID portion", () => {
		const id = generateId("pref");
		const uuidPart = id.split("_")[1];
		expect(uuidPart).not.toContain("-");
		expect(uuidPart).toHaveLength(32);
	});

	it("should work with all entity prefixes", () => {
		for (const [, prefix] of Object.entries(ID_PREFIX)) {
			const id = generateId(prefix);
			expect(id.startsWith(`${prefix}_`)).toBe(true);
			const uuidPart = id.slice(prefix.length + 1);
			expect(uuidPart).toMatch(/^[0-9a-f]{32}$/);
		}
	});

	it("should produce time-ordered IDs (UUID v7 monotonicity)", () => {
		const ids: string[] = [];
		for (let i = 0; i < 10; i++) {
			ids.push(generateId("ntf"));
		}
		// UUID v7 IDs are time-ordered, so lexicographic sort should match insertion order
		const sorted = [...ids].sort();
		expect(ids).toEqual(sorted);
	});

	it("should work with an empty string prefix producing _<uuid> format", () => {
		const id = generateId("");
		expect(id).toMatch(/^_[0-9a-f]{32}$/);
	});

	it("should work with a single-character prefix", () => {
		const id = generateId("x");
		expect(id).toMatch(/^x_[0-9a-f]{32}$/);
	});
});

describe("ID_PREFIX", () => {
	it("should be a frozen object", () => {
		expect(Object.isFrozen(ID_PREFIX)).toBe(true);
	});

	it("should contain all 26 entity prefixes", () => {
		// 17 core prefixes, 8 admin prefixes (audit, alert, alertHistory,
		// savedView, apiKey, scheduledSend, broadcast, templateOverride), and
		// teamMember (backing the emito_team_members table) make 26.
		expect(Object.keys(ID_PREFIX)).toHaveLength(26);
	});

	it("should have expected prefix values", () => {
		expect(ID_PREFIX.notification).toBe("ntf");
		expect(ID_PREFIX.preference).toBe("pref");
		expect(ID_PREFIX.workspaceDefault).toBe("wsd");
		expect(ID_PREFIX.category).toBe("cat");
		expect(ID_PREFIX.topic).toBe("top");
		expect(ID_PREFIX.topicSubscription).toBe("tsc");
		expect(ID_PREFIX.list).toBe("lst");
		expect(ID_PREFIX.listMember).toBe("lmb");
		expect(ID_PREFIX.inbox).toBe("inb");
		expect(ID_PREFIX.webhookEndpoint).toBe("whe");
		expect(ID_PREFIX.webhookDelivery).toBe("whd");
		expect(ID_PREFIX.pushToken).toBe("ptk");
		expect(ID_PREFIX.integration).toBe("int");
		expect(ID_PREFIX.consent).toBe("con");
		expect(ID_PREFIX.suppression).toBe("sup");
		expect(ID_PREFIX.deadLetter).toBe("dlq");
		expect(ID_PREFIX.erasureLog).toBe("erl");
	});

	it("should have the admin prefix values", () => {
		expect(ID_PREFIX.audit).toBe("aud");
		expect(ID_PREFIX.alert).toBe("alr");
		expect(ID_PREFIX.alertHistory).toBe("ahi");
		expect(ID_PREFIX.savedView).toBe("sav");
		expect(ID_PREFIX.apiKey).toBe("apk");
		expect(ID_PREFIX.scheduledSend).toBe("sch");
		expect(ID_PREFIX.broadcast).toBe("brc");
		expect(ID_PREFIX.templateOverride).toBe("tmo");
	});
});

describe("encodeCursor / decodeCursor", () => {
	it("should round-trip a timestamp string", () => {
		const original = "2026-04-01T12:00:00.000Z";
		const encoded = encodeCursor(original);
		const decoded = decodeCursor(encoded);
		expect(decoded).toBe(original);
	});

	it("should produce a base64url-encoded string", () => {
		const encoded = encodeCursor("2026-04-01T12:00:00.000Z");
		// base64url uses no padding, no + or /
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("should produce an opaque token different from the input", () => {
		const original = "2026-04-01T12:00:00.000Z";
		const encoded = encodeCursor(original);
		expect(encoded).not.toBe(original);
	});

	it("should round-trip an empty string", () => {
		const encoded = encodeCursor("");
		const decoded = decodeCursor(encoded);
		expect(decoded).toBe("");
	});

	it("should round-trip a string with special characters", () => {
		const original = "2026-04-01T12:00:00.000Z|extra+data/path=end";
		const encoded = encodeCursor(original);
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeCursor(encoded)).toBe(original);
	});
});

describe("cursorPaginate", () => {
	const makeRows = (count: number) =>
		Array.from({ length: count }, (_, i) => ({
			id: `row_${i}`,
			createdAt: new Date(2026, 0, 1, 0, 0, count - i).toISOString(),
		}));

	it("should return all rows and null cursor when rows fit within limit", () => {
		const rows = makeRows(5);
		const result = cursorPaginate(rows, 10, (r) => r.createdAt);
		expect(result.data).toHaveLength(5);
		expect(result.nextCursor).toBeNull();
	});

	it("should return limited rows and a nextCursor when there are more rows", () => {
		// Pass limit + 1 rows to simulate the query pattern (fetch limit+1 to detect hasMore)
		const rows = makeRows(6);
		const result = cursorPaginate(rows, 5, (r) => r.createdAt);
		expect(result.data).toHaveLength(5);
		expect(result.nextCursor).not.toBeNull();
	});

	it("should produce a decodable nextCursor", () => {
		const rows = makeRows(6);
		const result = cursorPaginate(rows, 5, (r) => r.createdAt);
		expect(result.nextCursor).not.toBeNull();
		const decoded = decodeCursor(result.nextCursor as string);
		expect(decoded).toBe(rows[4]?.createdAt);
	});

	it("should return empty data and null cursor for empty input", () => {
		const result = cursorPaginate([], 10, (r: { id: string }) => r.id);
		expect(result.data).toHaveLength(0);
		expect(result.nextCursor).toBeNull();
	});

	it("should handle exact limit match (no extra row) with null cursor", () => {
		const rows = makeRows(5);
		const result = cursorPaginate(rows, 5, (r) => r.createdAt);
		expect(result.data).toHaveLength(5);
		expect(result.nextCursor).toBeNull();
	});

	it("should handle limit=1 with more rows (single-item page)", () => {
		const rows = makeRows(3);
		const result = cursorPaginate(rows, 1, (r) => r.createdAt);
		expect(result.data).toHaveLength(1);
		expect(result.nextCursor).not.toBeNull();
		const decoded = decodeCursor(result.nextCursor as string);
		expect(decoded).toBe(rows[0]?.createdAt);
	});

	it("should return data as a plain array with the correct shape", () => {
		const rows = makeRows(3);
		const result = cursorPaginate(rows, 10, (r) => r.createdAt);
		expect(result).toMatchObject({
			data: expect.arrayContaining([expect.objectContaining({ id: "row_0" })]),
			nextCursor: null,
		});
	});
});

describe("withSoftDelete", () => {
	const softDeleteTable = pgTable("test_soft_delete", {
		erasedAt: timestamp({ withTimezone: true }),
	});

	it("should return a SQL object (IS NULL condition)", () => {
		const condition = withSoftDelete(softDeleteTable.erasedAt);
		expect(condition).toBeDefined();
		expect(typeof condition).toBe("object");
	});

	it("should produce a SQL fragment containing IS NULL semantics", () => {
		const condition = withSoftDelete(softDeleteTable.erasedAt);
		// The condition should be a Drizzle SQL object with queryChunks indicating IS NULL
		const sql = condition;
		expect(sql).toHaveProperty("queryChunks");
		const chunks = (sql as { queryChunks: unknown[] }).queryChunks;
		const sqlText = chunks
			.filter((c): c is { value: string } => typeof c === "object" && c !== null && "value" in c)
			.map((c) => c.value)
			.join("");
		expect(sqlText.toLowerCase()).toContain("is null");
	});
});

describe("withTransaction", () => {
	it("should delegate to db.transaction and return the result", async () => {
		const mockTx = { query: "mock" };
		const mockDb = {
			transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
		};
		const result = await withTransaction(
			mockDb as Parameters<typeof withTransaction>[0],
			async (tx) => {
				expect(tx).toBe(mockTx);
				return "txResult";
			},
		);
		expect(result).toBe("txResult");
	});

	it("should propagate errors from the transaction callback", async () => {
		const mockDb = {
			transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
		};
		await expect(
			withTransaction(mockDb as Parameters<typeof withTransaction>[0], async () => {
				throw new Error("tx failed");
			}),
		).rejects.toThrow("tx failed");
	});
});
