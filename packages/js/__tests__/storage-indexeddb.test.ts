import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexedDBStorageAdapter } from "../src/storage/indexeddb.js";

// ---------------------------------------------------------------------------
// Minimal IDB mock — models the shape the adapter actually uses
// ---------------------------------------------------------------------------

interface FakeIDBRequest {
	result: unknown;
	error: DOMException | null;
	onsuccess: ((ev: Event) => void) | null;
	onerror: ((ev: Event) => void) | null;
}

interface FakeIDBObjectStore {
	get(key: string): FakeIDBRequest;
	put(value: string, key: string): FakeIDBRequest;
	delete(key: string): FakeIDBRequest;
	clear(): FakeIDBRequest;
}

interface FakeIDBTransaction {
	objectStore(name: string): FakeIDBObjectStore;
}

interface FakeIDBDatabase {
	objectStoreNames: { contains: (name: string) => boolean };
	createObjectStore(name: string): void;
	transaction(storeNames: string, mode: "readonly" | "readwrite"): FakeIDBTransaction;
	close(): void;
}

function makeFakeDB(data: Map<string, string>): FakeIDBDatabase {
	function resolveAsync(req: FakeIDBRequest): void {
		Promise.resolve().then(() => req.onsuccess?.(new Event("success")));
	}

	const store: FakeIDBObjectStore = {
		get(key: string) {
			const req: FakeIDBRequest = {
				result: data.get(key) ?? undefined,
				error: null,
				onsuccess: null,
				onerror: null,
			};
			resolveAsync(req);
			return req;
		},
		put(value: string, key: string) {
			data.set(key, value);
			const req: FakeIDBRequest = { result: key, error: null, onsuccess: null, onerror: null };
			resolveAsync(req);
			return req;
		},
		delete(key: string) {
			data.delete(key);
			const req: FakeIDBRequest = {
				result: undefined,
				error: null,
				onsuccess: null,
				onerror: null,
			};
			resolveAsync(req);
			return req;
		},
		clear() {
			data.clear();
			const req: FakeIDBRequest = {
				result: undefined,
				error: null,
				onsuccess: null,
				onerror: null,
			};
			resolveAsync(req);
			return req;
		},
	};

	const db: FakeIDBDatabase = {
		objectStoreNames: { contains: (_name: string) => false },
		createObjectStore: vi.fn(),
		transaction(_storeName: string, _mode: "readonly" | "readwrite"): FakeIDBTransaction {
			return { objectStore: () => store };
		},
		close: vi.fn(),
	};
	return db;
}

interface FakeOpenRequest {
	result: FakeIDBDatabase | null;
	error: DOMException | null;
	onsuccess: ((ev: Event) => void) | null;
	onerror: ((ev: Event) => void) | null;
	onupgradeneeded: ((ev: Event) => void) | null;
}

function installMockIDB(
	db: FakeIDBDatabase,
	options: { failOpen?: boolean } = {},
): { openSpy: ReturnType<typeof vi.fn> } {
	const openSpy = vi
		.fn()
		.mockImplementation((_dbName: string, _version: number): FakeOpenRequest => {
			const req: FakeOpenRequest = {
				result: null,
				error: null,
				onsuccess: null,
				onerror: null,
				onupgradeneeded: null,
			};

			Promise.resolve().then(() => {
				if (options.failOpen) {
					req.error = new DOMException("Open failed", "UnknownError");
					req.onerror?.(new Event("error"));
				} else {
					req.result = db;
					// Trigger upgrade callback (adapter uses req.result inside onupgradeneeded)
					req.onupgradeneeded?.(new Event("upgradeneeded"));
					req.onsuccess?.(new Event("success"));
				}
			});

			return req;
		});

	// @ts-expect-error: patching global for test
	globalThis.indexedDB = { open: openSpy };

	return { openSpy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const _originalIndexedDB = (globalThis as unknown as Record<string, unknown>).indexedDB;

afterEach(() => {
	(globalThis as unknown as Record<string, unknown>).indexedDB = _originalIndexedDB;
	vi.restoreAllMocks();
});

describe("IndexedDBStorageAdapter", () => {
	let data: Map<string, string>;
	let db: FakeIDBDatabase;
	let openSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		data = new Map<string, string>();
		db = makeFakeDB(data);
		({ openSpy } = installMockIDB(db));
	});

	describe("initialization", () => {
		it("opens the database on first operation", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.getItem("k");
			expect(openSpy).toHaveBeenCalledTimes(1);
		});

		it("reuses the same connection across multiple operations", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.getItem("k1");
			await adapter.setItem("k2", "v2");
			await adapter.removeItem("k1");
			expect(openSpy).toHaveBeenCalledTimes(1);
		});

		it("calls createObjectStore during onupgradeneeded if store does not exist", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.getItem("k");
			// The adapter checks objectStoreNames.contains — our mock returns false,
			// so createObjectStore should have been called
			expect(db.createObjectStore).toHaveBeenCalledTimes(1);
		});

		it("accepts custom dbName and storeName via constructor options", async () => {
			const adapter = new IndexedDBStorageAdapter({ dbName: "my-db", storeName: "my-store" });
			await adapter.getItem("k");
			expect(openSpy).toHaveBeenCalledWith("my-db", 1);
		});

		it("uses default dbName 'emito-offline' when no options provided", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.getItem("k");
			expect(openSpy).toHaveBeenCalledWith("emito-offline", 1);
		});
	});

	describe("getItem", () => {
		it("returns null for a missing key", async () => {
			const adapter = new IndexedDBStorageAdapter();
			expect(await adapter.getItem("missing")).toBeNull();
		});

		it("returns a previously stored string value", async () => {
			data.set("greeting", "hello");
			const adapter = new IndexedDBStorageAdapter();
			expect(await adapter.getItem("greeting")).toBe("hello");
		});

		it("returns a JSON string as-is", async () => {
			const payload = JSON.stringify([{ action: "markAsRead", id: "ntf_1" }]);
			data.set("queue", payload);
			const adapter = new IndexedDBStorageAdapter();
			expect(await adapter.getItem("queue")).toBe(payload);
		});
	});

	describe("setItem", () => {
		it("stores a value that getItem can then retrieve", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.setItem("key", "value");
			expect(await adapter.getItem("key")).toBe("value");
		});

		it("overwrites an existing value", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.setItem("k", "old");
			await adapter.setItem("k", "new");
			expect(await adapter.getItem("k")).toBe("new");
		});

		it("can store an empty string", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.setItem("k", "");
			expect(await adapter.getItem("k")).toBe("");
		});

		it("isolates different keys", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.setItem("a", "1");
			await adapter.setItem("b", "2");
			expect(await adapter.getItem("a")).toBe("1");
			expect(await adapter.getItem("b")).toBe("2");
		});
	});

	describe("removeItem", () => {
		it("makes a key return null after removal", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.setItem("k", "v");
			await adapter.removeItem("k");
			expect(await adapter.getItem("k")).toBeNull();
		});

		it("does not throw when removing a nonexistent key", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await expect(adapter.removeItem("ghost")).resolves.toBeUndefined();
		});

		it("only removes the targeted key", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.setItem("a", "1");
			await adapter.setItem("b", "2");
			await adapter.removeItem("a");
			expect(await adapter.getItem("a")).toBeNull();
			expect(await adapter.getItem("b")).toBe("2");
		});
	});

	describe("clear", () => {
		it("removes all stored entries", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.setItem("x", "1");
			await adapter.setItem("y", "2");
			await adapter.clear();
			expect(await adapter.getItem("x")).toBeNull();
			expect(await adapter.getItem("y")).toBeNull();
		});

		it("is safe to call on an empty store", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await expect(adapter.clear()).resolves.toBeUndefined();
		});

		it("allows new values to be written after clear", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.setItem("k", "old");
			await adapter.clear();
			await adapter.setItem("k", "new");
			expect(await adapter.getItem("k")).toBe("new");
		});
	});

	describe("close", () => {
		it("closes the database connection", async () => {
			const adapter = new IndexedDBStorageAdapter();
			await adapter.getItem("k"); // triggers open
			adapter.close();
			expect(db.close).toHaveBeenCalledTimes(1);
		});

		it("is safe to call before any operation (no-op)", () => {
			const adapter = new IndexedDBStorageAdapter();
			expect(() => adapter.close()).not.toThrow();
		});
	});

	describe("StorageAdapter interface conformance", () => {
		it("implements all four required StorageAdapter methods", () => {
			const adapter = new IndexedDBStorageAdapter();
			expect(typeof adapter.getItem).toBe("function");
			expect(typeof adapter.setItem).toBe("function");
			expect(typeof adapter.removeItem).toBe("function");
			expect(typeof adapter.clear).toBe("function");
		});

		it("all methods return Promises", async () => {
			const adapter = new IndexedDBStorageAdapter();
			// Just checking the return type, not awaiting all
			const p = adapter.getItem("k");
			expect(p).toBeInstanceOf(Promise);
			await p; // ensure mock cleans up
		});
	});
});
