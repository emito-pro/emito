/**
 * Minimal typed event emitter — zero dependencies, works in all runtimes.
 * Generic parameter `T` is a map of event name → argument tuple.
 */
// biome-ignore lint/suspicious/noExplicitAny: generic constraint requires any for mapped type compatibility
export class TypedEmitter<T extends Record<string, any[]>> {
	private listeners = new Map<keyof T, Set<(...args: unknown[]) => void>>();

	on<K extends keyof T>(event: K, listener: (...args: T[K]) => void): this {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener as (...args: unknown[]) => void);
		return this;
	}

	off<K extends keyof T>(event: K, listener: (...args: T[K]) => void): this {
		const set = this.listeners.get(event);
		if (set) {
			set.delete(listener as (...args: unknown[]) => void);
			if (set.size === 0) this.listeners.delete(event);
		}
		return this;
	}

	emit<K extends keyof T>(event: K, ...args: T[K]): void {
		const set = this.listeners.get(event);
		if (!set) return;
		for (const listener of set) {
			try {
				listener(...args);
			} catch {
				// Listener threw — don't crash the emitter
			}
		}
	}

	removeAllListeners(event?: keyof T): this {
		if (event !== undefined) {
			this.listeners.delete(event);
		} else {
			this.listeners.clear();
		}
		return this;
	}

	listenerCount(event: keyof T): number {
		return this.listeners.get(event)?.size ?? 0;
	}
}
