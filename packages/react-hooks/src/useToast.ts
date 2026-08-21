import type { InAppAction, NotificationEvent } from "@emito/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClientEvent } from "./useClientEvent.js";

export interface ToastItem {
	id: string;
	body: string;
	subject?: string;
	avatar?: string;
	actionUrl?: string;
	primaryAction?: InAppAction;
	secondaryAction?: InAppAction;
	data?: Record<string, unknown>;
	duration?: number;
	createdAt: string;
}

export interface UseToastOptions {
	/** Auto-dismiss duration in ms. Default 5000. */
	duration?: number;
	/** Maximum number of toasts visible at once. Oldest dismissed when exceeded. Default 5. */
	maxSize?: number;
}

export interface UseToastResult {
	toasts: ToastItem[];
	add: (toast: Omit<ToastItem, "id" | "createdAt">) => void;
	dismiss: (id: string) => void;
	clear: () => void;
}

function eventToToast(event: NotificationEvent): Omit<ToastItem, "id" | "createdAt"> {
	return {
		body: event.body,
		subject: event.subject,
		avatar: event.avatar,
		actionUrl: event.actionUrl,
		primaryAction: event.primaryAction,
		secondaryAction: event.secondaryAction,
		data: event.data,
	};
}

export function useToast(options?: UseToastOptions): UseToastResult {
	const duration = options?.duration ?? 5000;
	const maxSize = options?.maxSize ?? 5;

	const [toasts, setToasts] = useState<ToastItem[]>([]);
	const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	const dismiss = useCallback((id: string) => {
		const timer = timersRef.current.get(id);
		if (timer != null) {
			clearTimeout(timer);
			timersRef.current.delete(id);
		}
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	const clear = useCallback(() => {
		for (const timer of timersRef.current.values()) {
			clearTimeout(timer);
		}
		timersRef.current.clear();
		setToasts([]);
	}, []);

	const add = useCallback(
		(toast: Omit<ToastItem, "id" | "createdAt">) => {
			const id = crypto.randomUUID();
			const item: ToastItem = {
				...toast,
				id,
				createdAt: new Date().toISOString(),
			};

			setToasts((prev) => {
				let next = [...prev];
				// Evict oldest if at capacity
				while (next.length >= maxSize && next.length > 0) {
					const oldest = next[0];
					if (oldest == null) break;
					const oldTimer = timersRef.current.get(oldest.id);
					if (oldTimer != null) {
						clearTimeout(oldTimer);
						timersRef.current.delete(oldest.id);
					}
					next = next.slice(1);
				}
				return [...next, item];
			});

			const dismissMs = toast.duration ?? duration;
			const timer = setTimeout(() => {
				dismiss(id);
			}, dismissMs);
			timersRef.current.set(id, timer);
		},
		[duration, maxSize, dismiss],
	);

	// Subscribe to real-time notification events
	useClientEvent<[NotificationEvent]>("notification", (event) => {
		add(eventToToast(event));
	});

	// Clean up all timers on unmount
	useEffect(() => {
		return () => {
			for (const timer of timersRef.current.values()) {
				clearTimeout(timer);
			}
			timersRef.current.clear();
		};
	}, []);

	return { toasts, add, dismiss, clear };
}
