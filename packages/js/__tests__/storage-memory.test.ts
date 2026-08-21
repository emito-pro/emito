import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorageAdapter } from "../src/storage/memory.js";

describe("MemoryStorageAdapter", () => {
	let adapter: MemoryStorageAdapter;

	beforeEach(() => {
		adapter = new MemoryStorageAdapter();
	});

	afterEach(() => {
		// no teardown needed — in-memory is isolated per instance
	});

	describe("getItem", () => {
		it("returns null for missing key", async () => {
			const result = await adapter.getItem("nonexistent");
			expect(result).toBeNull();
		});

		it("returns stored value after setItem", async () => {
			await adapter.setItem("foo", "bar");
			const result = await adapter.getItem("foo");
			expect(result).toBe("bar");
		});

		it("returns the most recently set value when a key is overwritten", async () => {
			await adapter.setItem("key", "first");
			await adapter.setItem("key", "second");
			const result = await adapter.getItem("key");
			expect(result).toBe("second");
		});

		it("isolates keys from each other", async () => {
			await adapter.setItem("a", "1");
			await adapter.setItem("b", "2");
			expect(await adapter.getItem("a")).toBe("1");
			expect(await adapter.getItem("b")).toBe("2");
		});
	});

	describe("setItem", () => {
		it("stores a value that can be retrieved", async () => {
			await adapter.setItem("k", "v");
			expect(await adapter.getItem("k")).toBe("v");
		});

		it("can store JSON strings", async () => {
			const obj = JSON.stringify({ action: "markAsRead", id: "ntf_1" });
			await adapter.setItem("queue", obj);
			expect(await adapter.getItem("queue")).toBe(obj);
		});

		it("can store empty string", async () => {
			await adapter.setItem("empty", "");
			expect(await adapter.getItem("empty")).toBe("");
		});
	});

	describe("removeItem", () => {
		it("removes an existing key", async () => {
			await adapter.setItem("foo", "bar");
			await adapter.removeItem("foo");
			expect(await adapter.getItem("foo")).toBeNull();
		});

		it("does not throw when removing a nonexistent key", async () => {
			await expect(adapter.removeItem("nonexistent")).resolves.toBeUndefined();
		});

		it("only removes the targeted key", async () => {
			await adapter.setItem("a", "1");
			await adapter.setItem("b", "2");
			await adapter.removeItem("a");
			expect(await adapter.getItem("a")).toBeNull();
			expect(await adapter.getItem("b")).toBe("2");
		});
	});

	describe("clear", () => {
		it("removes all stored keys", async () => {
			await adapter.setItem("x", "1");
			await adapter.setItem("y", "2");
			await adapter.clear();
			expect(await adapter.getItem("x")).toBeNull();
			expect(await adapter.getItem("y")).toBeNull();
		});

		it("is safe to call on an empty store", async () => {
			await expect(adapter.clear()).resolves.toBeUndefined();
		});

		it("allows new values to be stored after clear", async () => {
			await adapter.setItem("k", "old");
			await adapter.clear();
			await adapter.setItem("k", "new");
			expect(await adapter.getItem("k")).toBe("new");
		});
	});

	describe("StorageAdapter interface conformance", () => {
		it("implements all four required methods", () => {
			expect(typeof adapter.getItem).toBe("function");
			expect(typeof adapter.setItem).toBe("function");
			expect(typeof adapter.removeItem).toBe("function");
			expect(typeof adapter.clear).toBe("function");
		});

		it("all methods return Promises", async () => {
			expect(adapter.setItem("k", "v")).toBeInstanceOf(Promise);
			expect(adapter.getItem("k")).toBeInstanceOf(Promise);
			expect(adapter.removeItem("k")).toBeInstanceOf(Promise);
			expect(adapter.clear()).toBeInstanceOf(Promise);
		});
	});
});
