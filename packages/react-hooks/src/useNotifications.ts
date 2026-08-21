import type { NotificationItem, NotificationListParams } from "@emito/js";
import type { NotificationEvent } from "@emito/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEmitoClient } from "./context.js";
import { useClientEvent } from "./useClientEvent.js";

export interface UseNotificationsParams {
	status?: string;
	category?: string;
	limit?: number;
}

export interface UseNotificationsResult {
	notifications: NotificationItem[];
	isLoading: boolean;
	hasMore: boolean;
	fetchMore: () => Promise<void>;
	markAsRead: (id: string) => Promise<void>;
	markAsUnread: (id: string) => Promise<void>;
	markAllAsRead: () => Promise<void>;
	archive: (id: string) => Promise<void>;
	snooze: (id: string, until: Date) => Promise<void>;
}

function matchesFilters(event: NotificationEvent, params?: UseNotificationsParams): boolean {
	if (!params) return true;
	if (params.status === "read") return false;
	if (params.category && event.category !== params.category) return false;
	return true;
}

export function useNotifications(params?: UseNotificationsParams): UseNotificationsResult {
	const client = useEmitoClient();
	const [notifications, setNotifications] = useState<NotificationItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [hasMore, setHasMore] = useState(false);
	const cursorRef = useRef<string | undefined>(undefined);
	const fetchIdRef = useRef(0);

	// Fetch on mount + when filters change. fetchIdRef discards stale responses.
	useEffect(() => {
		const id = ++fetchIdRef.current;
		const fetchParams: NotificationListParams = {};
		if (params?.status) fetchParams.status = params.status;
		if (params?.category) fetchParams.category = params.category;
		if (params?.limit) fetchParams.limit = params.limit;

		setIsLoading(true);
		cursorRef.current = undefined;

		client.notifications
			.list(fetchParams)
			.then((result) => {
				if (id !== fetchIdRef.current) return;
				setNotifications(result.items);
				setHasMore(result.hasMore);
				cursorRef.current = result.cursor;
				setIsLoading(false);
			})
			.catch(() => {
				if (id !== fetchIdRef.current) return;
				setIsLoading(false);
			});
	}, [client, params?.status, params?.category, params?.limit]);

	// Remove snoozed notifications from the local list
	useClientEvent<[string]>("snoozed", (id) => {
		setNotifications((prev) => prev.filter((n) => n.id !== id));
		client.fetchUnreadCount().catch(() => {});
	});

	// Prepend real-time WS notifications if they match our filters
	useClientEvent<[NotificationEvent, string | undefined]>("notification", (event) => {
		if (!matchesFilters(event, params)) return;
		const item: NotificationItem = {
			id: event.notificationId,
			subscriberId: event.subscriberId,
			event: event.event,
			category: event.category,
			topic: event.topic,
			subject: event.subject,
			body: event.body,
			avatar: event.avatar,
			actionUrl: event.actionUrl,
			primaryAction: event.primaryAction,
			secondaryAction: event.secondaryAction,
			data: event.data,
			readAt: null,
			archivedAt: null,
			snoozedUntil: null,
			createdAt:
				event.timestamp instanceof Date ? event.timestamp.toISOString() : String(event.timestamp),
		};
		setNotifications((prev) => [item, ...prev]);
	});

	const fetchMore = useCallback(async () => {
		const fetchParams: NotificationListParams = {};
		if (params?.status) fetchParams.status = params.status;
		if (params?.category) fetchParams.category = params.category;
		if (params?.limit) fetchParams.limit = params.limit;
		if (cursorRef.current) fetchParams.cursor = cursorRef.current;

		const result = await client.notifications.list(fetchParams);
		setNotifications((prev) => [...prev, ...result.items]);
		setHasMore(result.hasMore);
		cursorRef.current = result.cursor;
	}, [client, params?.status, params?.category, params?.limit]);

	const markAsRead = useCallback(
		async (id: string) => {
			setNotifications((prev) =>
				prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
			);
			try {
				await client.markAsRead(id);
				await client.fetchUnreadCount();
			} catch {
				setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: null } : n)));
			}
		},
		[client],
	);

	const markAsUnread = useCallback(
		async (id: string) => {
			let previous: NotificationItem[] = [];
			setNotifications((prev) => {
				previous = prev;
				return prev.map((n) => (n.id === id ? { ...n, readAt: null } : n));
			});
			try {
				await client.markAsUnread(id);
				await client.fetchUnreadCount();
			} catch {
				setNotifications(previous);
			}
		},
		[client],
	);

	const markAllAsRead = useCallback(async () => {
		const now = new Date().toISOString();
		let previous: NotificationItem[] = [];
		setNotifications((prev) => {
			previous = prev;
			return prev.map((n) => (n.readAt ? n : { ...n, readAt: now }));
		});
		try {
			await client.markAllAsRead();
			await client.fetchUnreadCount();
		} catch {
			setNotifications(previous);
		}
	}, [client]);

	const archive = useCallback(
		async (id: string) => {
			let previous: NotificationItem[] = [];
			setNotifications((prev) => {
				previous = prev;
				return prev.filter((n) => n.id !== id);
			});
			try {
				await client.archive(id);
				await client.fetchUnreadCount();
			} catch {
				setNotifications(previous);
			}
		},
		[client],
	);

	const snooze = useCallback(
		async (id: string, until: Date) => {
			setNotifications((prev) => prev.filter((n) => n.id !== id));
			await client.notifications.snooze(id, until);
			await client.fetchUnreadCount();
		},
		[client],
	);

	return {
		notifications,
		isLoading,
		hasMore,
		fetchMore,
		markAsRead,
		markAsUnread,
		markAllAsRead,
		archive,
		snooze,
	};
}
