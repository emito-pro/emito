/**
 * Storage adapter interface for offline queue persistence.
 * All methods are async to support IndexedDB and other async backends.
 */
export interface StorageAdapter {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
	clear(): Promise<void>;
}
