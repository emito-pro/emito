import { getToken } from "./auth";

export interface TriggerResult {
	notificationId: string;
	channels: Array<{ channel: string; status: string }>;
}

export async function triggerEvent(
	event: string,
	payload?: Record<string, unknown>,
): Promise<TriggerResult> {
	const token = getToken();
	if (!token) throw new Error("Not authenticated");

	const res = await fetch(`/api/trigger/${encodeURIComponent(event)}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ workspaceId: "ws_acme-trading", payload }),
	});

	if (!res.ok) {
		const data = await res.json().catch(() => ({ error: "Request failed" }));
		throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
	}

	return res.json() as Promise<TriggerResult>;
}
