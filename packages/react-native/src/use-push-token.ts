import { useEmitoClient } from "@emito/react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";

export type PushPlatform = "fcm" | "apns";

export interface UsePushTokenOptions {
	/** Static push token string */
	token?: string;
	/** Async function to retrieve the push token (called on mount) */
	getToken?: () => Promise<string>;
	/** Push notification platform */
	platform: PushPlatform;
	/** When true (default), automatically registers the token with the Emito server on mount */
	autoRegister?: boolean;
}

export interface UsePushTokenResult {
	/** The resolved push token (null until resolved) */
	token: string | null;
	/** Whether registration is currently in progress */
	isRegistering: boolean;
	/** Error from token resolution or registration */
	error: Error | null;
	/** Manual registration trigger (useful when autoRegister is false) */
	register: () => Promise<void>;
}

/**
 * Hook for registering a device push token with the Emito server.
 *
 * Accepts a static `token` string or a `getToken` async function.
 * By default, auto-registers on mount and re-registers when the token changes.
 * Set `autoRegister: false` for manual control via the returned `register()`.
 */
export function usePushToken(options: UsePushTokenOptions): UsePushTokenResult {
	const { token: tokenProp, getToken, platform, autoRegister = true } = options;
	const client = useEmitoClient();

	const [resolvedToken, setResolvedToken] = useState<string | null>(tokenProp ?? null);
	const [isRegistering, setIsRegistering] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	// Track the last registered token to avoid duplicate registrations
	const lastRegisteredRef = useRef<string | null>(null);
	// Track whether the component is still mounted
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// Resolve token from getToken() on mount
	useEffect(() => {
		if (tokenProp !== undefined) {
			setResolvedToken(tokenProp);
			return;
		}

		if (!getToken) return;

		let cancelled = false;

		getToken()
			.then((t) => {
				if (!cancelled) {
					setResolvedToken(t);
				}
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setError(err instanceof Error ? err : new Error("Failed to get push token"));
				}
			});

		return () => {
			cancelled = true;
		};
	}, [tokenProp, getToken]);

	// Registration function — registers the token with the Emito server
	const registerToken = useCallback(
		async (tokenToRegister?: string) => {
			const t = tokenToRegister ?? resolvedToken;
			if (!t) {
				setError(new Error("No push token available to register"));
				return;
			}

			setIsRegistering(true);
			setError(null);

			try {
				await client.integrations.create({
					channel: "push",
					name: `${platform}-device`,
					events: [],
					config: { token: t, platform },
				});

				if (mountedRef.current) {
					lastRegisteredRef.current = t;
					setIsRegistering(false);
				}
			} catch (err: unknown) {
				if (mountedRef.current) {
					setError(err instanceof Error ? err : new Error("Failed to register push token"));
					setIsRegistering(false);
				}
			}
		},
		[client, platform, resolvedToken],
	);

	// Auto-register on mount and when token changes
	useEffect(() => {
		if (!autoRegister) return;
		if (!resolvedToken) return;
		if (resolvedToken === lastRegisteredRef.current) return;

		registerToken(resolvedToken);
	}, [autoRegister, resolvedToken, registerToken]);

	const register = useCallback(() => registerToken(), [registerToken]);

	return {
		token: resolvedToken,
		isRegistering,
		error,
		register,
	};
}
