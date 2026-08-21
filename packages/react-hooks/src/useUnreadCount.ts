import { useEffect, useState } from "react";
import { useEmitoClient } from "./context.js";
import { useClientEvent } from "./useClientEvent.js";

export interface UseUnreadCountResult {
	unreadCount: number;
}

export function useUnreadCount(): UseUnreadCountResult {
	const client = useEmitoClient();
	const [unreadCount, setUnreadCount] = useState(0);

	useEffect(() => {
		client.notifications
			.unreadCount()
			.then(setUnreadCount)
			.catch(() => {});
	}, [client]);

	useClientEvent("notification", () => {
		setUnreadCount((prev) => prev + 1);
	});

	useClientEvent<[number]>("unreadCount", (count) => {
		setUnreadCount(count);
	});

	return { unreadCount };
}
