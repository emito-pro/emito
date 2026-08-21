import { useEffect, useRef } from "react";
import { useEmitoClient } from "./context.js";

/**
 * Subscribe to an EmitoClient event with automatic cleanup on unmount.
 * The handler is kept in a ref to avoid resubscription on every render.
 */
export function useClientEvent<T extends unknown[]>(
	event: string,
	handler: (...args: T) => void,
): void {
	const client = useEmitoClient();
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		const listener = (...args: unknown[]) => {
			handlerRef.current(...(args as T));
		};
		client.on(event as never, listener as never);
		return () => {
			client.off(event as never, listener as never);
		};
	}, [client, event]);
}
