import type { PreferenceUpdateParams, PreferencesApi } from "@emito/js";
import { useCallback, useEffect, useState } from "react";
import { useEmitoClient } from "./context.js";

type PreferenceRecord = Awaited<ReturnType<PreferencesApi["get"]>>[number];

export interface UsePreferencesOptions {
	workspaceId?: string;
}

export interface UsePreferencesResult {
	preferences: PreferenceRecord[];
	isLoading: boolean;
	updatePreference: (params: PreferenceUpdateParams) => Promise<void>;
	resetPreferences: () => Promise<void>;
}

export function usePreferences(options?: UsePreferencesOptions): UsePreferencesResult {
	const client = useEmitoClient();
	const [preferences, setPreferences] = useState<PreferenceRecord[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const workspaceId = options?.workspaceId;

	useEffect(() => {
		setIsLoading(true);
		const fetch = workspaceId
			? client.preferences.getForWorkspace(workspaceId)
			: client.preferences.get();

		fetch
			.then((prefs) => {
				setPreferences(prefs);
				setIsLoading(false);
			})
			.catch(() => setIsLoading(false));
	}, [client, workspaceId]);

	const updatePreference = useCallback(
		async (params: PreferenceUpdateParams) => {
			if (workspaceId) {
				await client.preferences.updateForWorkspace(workspaceId, params);
			} else {
				await client.preferences.update(params);
			}
			const prefs = workspaceId
				? await client.preferences.getForWorkspace(workspaceId)
				: await client.preferences.get();
			setPreferences(prefs);
		},
		[client, workspaceId],
	);

	const resetPreferences = useCallback(async () => {
		await client.preferences.reset();
		const prefs = workspaceId
			? await client.preferences.getForWorkspace(workspaceId)
			: await client.preferences.get();
		setPreferences(prefs);
	}, [client, workspaceId]);

	return { preferences, isLoading, updatePreference, resetPreferences };
}
