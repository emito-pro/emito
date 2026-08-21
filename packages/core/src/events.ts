import type { NotificationEvent } from "@emito/types";

/**
 * Map of event names to their handler signatures.
 */
export type EmitoInstanceEvents = {
	"notification:created": (subscriberId: string, event: NotificationEvent) => void;
};

// biome-ignore lint/suspicious/noExplicitAny: generic event map constraint
export interface TypedEmitter<T extends Record<string, (...args: any[]) => void>> {
	on<K extends keyof T & string>(event: K, handler: T[K]): void;
	off<K extends keyof T & string>(event: K, handler: T[K]): void;
	emit<K extends keyof T & string>(event: K, ...args: Parameters<T[K]>): void;
}

/**
 * Create a type-safe event emitter with no external dependencies.
 * Internally uses a Map of subscriber sets.
 */
export function createTypedEmitter<
	// biome-ignore lint/suspicious/noExplicitAny: generic event map constraint
	T extends Record<string, (...args: any[]) => void>,
>(options?: { onListenerError?: (event: string, error: unknown) => void }): TypedEmitter<T> {
	// biome-ignore lint/suspicious/noExplicitAny: internal handler storage
	const listeners = new Map<string, Set<(...args: any[]) => void>>();

	return {
		on<K extends keyof T & string>(event: K, handler: T[K]): void {
			let set = listeners.get(event);
			if (!set) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(handler);
		},

		off<K extends keyof T & string>(event: K, handler: T[K]): void {
			const set = listeners.get(event);
			if (set) {
				set.delete(handler);
				if (set.size === 0) listeners.delete(event);
			}
		},

		emit<K extends keyof T & string>(event: K, ...args: Parameters<T[K]>): void {
			const set = listeners.get(event);
			if (!set) return;
			for (const handler of set) {
				try {
					handler(...args);
				} catch (error) {
					if (options?.onListenerError) {
						options.onListenerError(event, error);
					} else {
						console.error(`[emito] listener for event "${event}" threw:`, error);
					}
				}
			}
		},
	};
}
