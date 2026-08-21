import { EmitoClient } from "@emito/js";
import type { EmitoClientOptions } from "@emito/js";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

const EmitoContext = createContext<EmitoClient | null>(null);

export interface EmitoProviderProps extends EmitoClientOptions {
	children?: ReactNode;
}

/**
 * React context provider that creates and manages an EmitoClient instance.
 * Connects on mount, disconnects on unmount, and recreates the client
 * when key props (endpoint, subscriberId, token) change. When `getToken`
 * is provided, `token` refreshes alone do not recreate the client.
 */
export function EmitoProvider({ children, ...options }: EmitoProviderProps): ReactNode {
	// Serialize key props to detect changes — only these trigger client recreation.
	// When getToken is provided, token is excluded from the key so a token refresh
	// (which changes options.token but not the getToken reference) doesn't tear
	// down and recreate the client (and its SSE/WS connection).
	const key = options.getToken
		? `${options.endpoint}:${options.subscriberId}:fn`
		: `${options.endpoint}:${options.subscriberId}:${options.token}`;

	// Keep latest options in a ref so the effect always has current values
	const optionsRef = useRef(options);
	optionsRef.current = options;

	// Stable wrapper that always calls the latest getToken from the ref,
	// avoiding stale closures when the parent passes a new arrow each render.
	// biome-ignore lint/style/noNonNullAssertion: only ever wired in via buildOptions when opts.getToken is present, so it is defined at call time — an optional chain would change the token contract to possibly-undefined
	const stableGetToken = useCallback(() => optionsRef.current.getToken!(), []);

	const buildOptions = useCallback(
		(opts: EmitoClientOptions): EmitoClientOptions =>
			opts.getToken ? { ...opts, getToken: stableGetToken } : opts,
		[stableGetToken],
	);

	// Lazy initial client — created once during first render (no side effects)
	const [client, setClient] = useState(() => new EmitoClient(buildOptions(options)));

	// Track the key that corresponds to the current client
	const keyRef = useRef(key);

	// biome-ignore lint/correctness/useExhaustiveDependencies: client is managed by this effect — adding it would cause infinite recreation loops
	useEffect(() => {
		let currentClient = client;

		// If key props changed since the client was created, recreate
		if (keyRef.current !== key) {
			keyRef.current = key;
			currentClient.disconnect();
			currentClient = new EmitoClient(buildOptions(optionsRef.current));
			setClient(currentClient);
		}

		currentClient.connect().catch(() => {
			// Connection errors are surfaced via client.on('error')
		});

		return () => {
			currentClient.disconnect();
		};
	}, [key]); // eslint-disable-line react-hooks/exhaustive-deps

	return <EmitoContext.Provider value={client}>{children}</EmitoContext.Provider>;
}

/**
 * Access the raw EmitoClient from the nearest EmitoProvider.
 * Throws if used outside an EmitoProvider.
 */
export function useEmitoClient(): EmitoClient {
	const client = useContext(EmitoContext);
	if (!client) {
		throw new Error("useEmitoClient must be used within an EmitoProvider");
	}
	return client;
}
