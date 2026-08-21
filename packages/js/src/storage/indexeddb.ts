/// <reference lib="dom" />
import type { StorageAdapter } from "./types.js";

const DEFAULT_DB_NAME = "emito-offline";
const DEFAULT_STORE_NAME = "kv";
const DB_VERSION = 1;

export interface IndexedDBAdapterOptions {
	/** Database name (default: "emito-offline") */
	dbName?: string;
	/** Object store name (default: "kv") */
	storeName?: string;
}

/**
 * IndexedDB-backed storage adapter for browser persistence.
 * Stores key-value pairs that survive page reloads.
 */
export class IndexedDBStorageAdapter implements StorageAdapter {
	private readonly dbName: string;
	private readonly storeName: string;
	private db: IDBDatabase | null = null;

	constructor(options?: IndexedDBAdapterOptions) {
		this.dbName = options?.dbName ?? DEFAULT_DB_NAME;
		this.storeName = options?.storeName ?? DEFAULT_STORE_NAME;
	}

	async getItem(key: string): Promise<string | null> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, "readonly");
			const store = tx.objectStore(this.storeName);
			const req = store.get(key);
			req.onsuccess = () => resolve((req.result as string) ?? null);
			req.onerror = () => reject(req.error);
		});
	}

	async setItem(key: string, value: string): Promise<void> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, "readwrite");
			const store = tx.objectStore(this.storeName);
			const req = store.put(value, key);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	}

	async removeItem(key: string): Promise<void> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, "readwrite");
			const store = tx.objectStore(this.storeName);
			const req = store.delete(key);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	}

	async clear(): Promise<void> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, "readwrite");
			const store = tx.objectStore(this.storeName);
			const req = store.clear();
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	}

	/** Close the database connection */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	private async open(): Promise<IDBDatabase> {
		if (this.db) return this.db;

		return new Promise((resolve, reject) => {
			const req = indexedDB.open(this.dbName, DB_VERSION);

			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName);
				}
			};

			req.onsuccess = () => {
				this.db = req.result;
				resolve(this.db);
			};

			req.onerror = () => reject(req.error);
		});
	}
}
