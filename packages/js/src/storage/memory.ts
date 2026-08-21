import type { StorageAdapter } from "./types.js";

/**
 * In-memory storage adapter — used as fallback when IndexedDB is unavailable.
 * Data does not survive page reloads.
 */
export class MemoryStorageAdapter implements StorageAdapter {
	private data = new Map<string, string>();

	async getItem(key: string): Promise<string | null> {
		return this.data.get(key) ?? null;
	}

	async setItem(key: string, value: string): Promise<void> {
		this.data.set(key, value);
	}

	async removeItem(key: string): Promise<void> {
		this.data.delete(key);
	}

	async clear(): Promise<void> {
		this.data.clear();
	}
}
