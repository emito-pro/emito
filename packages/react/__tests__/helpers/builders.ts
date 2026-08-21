import type { NotificationItem } from "@emito/js";
import type { NotificationEvent } from "@emito/types";
import type { Channel, PreferenceRecord, WorkspaceDefault } from "@emito/types";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixed timestamps — deterministic across all tests
// ---------------------------------------------------------------------------

const FIXED_PAST = new Date("2026-04-16T11:55:00.000Z");
const FIXED_NOW = new Date("2026-04-16T12:00:00.000Z");

// ---------------------------------------------------------------------------
// NotificationItem builder
// ---------------------------------------------------------------------------

let notifCounter = 0;

export function createNotificationItem(
	overrides: Partial<NotificationItem> = {},
): NotificationItem {
	const i = ++notifCounter;
	return {
		id: `notif_${i}`,
		subscriberId: "sub_1",
		event: "order.filled",
		subject: `Notification ${i}`,
		body: `Body for notification ${i}`,
		createdAt: FIXED_PAST.toISOString(),
		readAt: null,
		archivedAt: null,
		snoozedUntil: null,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// NotificationEvent builder
// ---------------------------------------------------------------------------

let eventCounter = 0;

export function createNotificationEvent(
	overrides: Partial<NotificationEvent> = {},
): NotificationEvent {
	const i = ++eventCounter;
	return {
		notificationId: `notif_evt_${i}`,
		subscriberId: "sub_1",
		event: "order.filled",
		body: `Event body ${i}`,
		subject: `Event ${i}`,
		timestamp: FIXED_NOW,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// PreferenceRecord builder
// ---------------------------------------------------------------------------

export function createPreferenceRecord(
	overrides: Partial<PreferenceRecord> = {},
): PreferenceRecord {
	return {
		subscriberId: "sub_1",
		topicKey: "feature-announcement",
		channel: "email" as Channel,
		enabled: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// WorkspaceDefault builder
// ---------------------------------------------------------------------------

export function createWorkspaceDefault(
	overrides: Partial<WorkspaceDefault> = {},
): WorkspaceDefault {
	return {
		workspaceId: "ws_1",
		topicKey: "promotions",
		channel: "email" as Channel,
		enabled: false,
		isMandatory: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Mock EmitoClient factory (for hooks that call useEmitoClient)
// ---------------------------------------------------------------------------

export interface MockEmitoClient {
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	off: ReturnType<typeof vi.fn>;
	emit: ReturnType<typeof vi.fn>;
	markAsRead: ReturnType<typeof vi.fn>;
	markAsUnread: ReturnType<typeof vi.fn>;
	markAllAsRead: ReturnType<typeof vi.fn>;
	archive: ReturnType<typeof vi.fn>;
	notifications: {
		list: ReturnType<typeof vi.fn>;
		unreadCount: ReturnType<typeof vi.fn>;
		markAsRead: ReturnType<typeof vi.fn>;
		markAsUnread: ReturnType<typeof vi.fn>;
		markAllAsRead: ReturnType<typeof vi.fn>;
		archive: ReturnType<typeof vi.fn>;
		unarchive: ReturnType<typeof vi.fn>;
		snooze: ReturnType<typeof vi.fn>;
	};
	preferences: {
		get: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
		getForWorkspace: ReturnType<typeof vi.fn>;
		updateForWorkspace: ReturnType<typeof vi.fn>;
		reset: ReturnType<typeof vi.fn>;
	};
	integrations: {
		list: ReturnType<typeof vi.fn>;
		deactivate: ReturnType<typeof vi.fn>;
	};
}

export function createMockEmitoClient(): MockEmitoClient {
	return {
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		emit: vi.fn(),
		markAsRead: vi.fn().mockResolvedValue(undefined),
		markAsUnread: vi.fn().mockResolvedValue(undefined),
		markAllAsRead: vi.fn().mockResolvedValue(undefined),
		archive: vi.fn().mockResolvedValue(undefined),
		notifications: {
			list: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
			unreadCount: vi.fn().mockResolvedValue(0),
			markAsRead: vi.fn().mockResolvedValue(undefined),
			markAsUnread: vi.fn().mockResolvedValue(undefined),
			markAllAsRead: vi.fn().mockResolvedValue(undefined),
			archive: vi.fn().mockResolvedValue(undefined),
			unarchive: vi.fn().mockResolvedValue(undefined),
			snooze: vi.fn().mockResolvedValue(undefined),
		},
		preferences: {
			get: vi.fn().mockResolvedValue([]),
			update: vi.fn().mockResolvedValue(undefined),
			getForWorkspace: vi.fn().mockResolvedValue([]),
			updateForWorkspace: vi.fn().mockResolvedValue(undefined),
			reset: vi.fn().mockResolvedValue(undefined),
		},
		integrations: {
			list: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
			deactivate: vi.fn().mockResolvedValue(undefined),
		},
	};
}

/**
 * Reset builder counters — call in beforeEach for deterministic IDs.
 */
export function resetBuilderCounters(): void {
	notifCounter = 0;
	eventCounter = 0;
}
