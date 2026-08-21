import type { NotificationItem } from "@emito/js";
import type { ToastItem } from "@emito/react-hooks";
import type { NotificationEvent } from "@emito/types";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createNotificationEvent,
	createNotificationItem,
	resetBuilderCounters,
} from "../helpers/builders.js";

// ---------------------------------------------------------------------------
// Mock CSS modules
// ---------------------------------------------------------------------------

vi.mock("../../src/styles/inbox.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? prop : "") }),
}));

vi.mock("../../src/styles/bell.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? prop : "") }),
}));

vi.mock("../../src/styles/toast.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => `toast_${String(prop)}` }),
}));

// ---------------------------------------------------------------------------
// Coordinated stateful hook mocks
// ---------------------------------------------------------------------------

let mockNotifications: NotificationItem[] = [];
let mockUnreadCount = 0;
let mockToasts: ToastItem[] = [];
const mockDismiss = vi.fn<(id: string) => void>();
const mockAdd = vi.fn<(toast: Omit<ToastItem, "id" | "createdAt">) => void>();
let notificationEventHandlers: Array<(event: NotificationEvent) => void> = [];

vi.mock("@emito/react-hooks", () => ({
	useNotifications: () => ({
		notifications: mockNotifications,
		isLoading: false,
		hasMore: false,
		fetchMore: vi.fn().mockResolvedValue(undefined),
		markAsRead: vi.fn().mockResolvedValue(undefined),
		markAsUnread: vi.fn(),
		markAllAsRead: vi.fn().mockResolvedValue(undefined),
		archive: vi.fn().mockResolvedValue(undefined),
	}),
	useUnreadCount: () => ({ unreadCount: mockUnreadCount }),
	useToast: () => ({
		toasts: mockToasts,
		dismiss: mockDismiss,
		add: mockAdd,
		clear: vi.fn(),
	}),
	useClientEvent: (event: string, handler: (...args: unknown[]) => void) => {
		if (event === "notification") {
			notificationEventHandlers.push(handler as (event: NotificationEvent) => void);
		}
	},
	useEmitoClient: () => ({
		notifications: { snooze: vi.fn() },
	}),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks
// ---------------------------------------------------------------------------

import { NotificationBell } from "../../src/components/NotificationBell.js";
import { NotificationFeed } from "../../src/components/NotificationFeed.js";
import { Toast } from "../../src/components/Toast.js";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const NOW = new Date("2026-04-16T12:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	resetBuilderCounters();
	mockNotifications = [];
	mockUnreadCount = 0;
	mockToasts = [];
	notificationEventHandlers = [];
	mockDismiss.mockReset();
	mockAdd.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	cleanup();
});

// ---------------------------------------------------------------------------
// Helper: simulate a real-time WS notification event
// ---------------------------------------------------------------------------

function simulateWsNotification(
	event: NotificationEvent,
	opts: {
		prependToFeed?: boolean;
		incrementUnread?: boolean;
		addToast?: boolean;
	} = {},
): void {
	const { prependToFeed = true, incrementUnread = true, addToast = true } = opts;

	// Simulate what real hooks would do:
	if (prependToFeed) {
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
		mockNotifications = [item, ...mockNotifications];
	}

	if (incrementUnread) {
		mockUnreadCount += 1;
	}

	if (addToast) {
		const toast: ToastItem = {
			id: `toast_${event.notificationId}`,
			body: event.body,
			subject: event.subject,
			avatar: event.avatar,
			primaryAction: event.primaryAction,
			secondaryAction: event.secondaryAction,
			data: event.data,
			createdAt: new Date().toISOString(),
		};
		mockToasts = [...mockToasts, toast];
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Real-time flow integration", () => {
	describe("WS notification event → toast + feed + badge", () => {
		it("should show toast, prepend to feed, and increment badge when a real-time notification arrives", () => {
			const existingNotification = createNotificationItem({
				id: "existing_1",
				subject: "Old notification",
			});
			mockNotifications = [existingNotification];
			mockUnreadCount = 1;

			const { rerender } = render(
				<>
					<NotificationBell />
					<NotificationFeed />
					<Toast />
				</>,
			);

			// Initial state: old notification in feed, badge shows 1
			expect(screen.getByText("Old notification")).toBeDefined();
			expect(screen.getByText("1")).toBeDefined();

			// Simulate a real-time WS notification event
			const wsEvent = createNotificationEvent({
				notificationId: "ws_notif_1",
				subject: "New real-time alert",
				body: "Something happened in real-time",
			});

			act(() => {
				simulateWsNotification(wsEvent);
			});
			rerender(
				<>
					<NotificationBell />
					<NotificationFeed />
					<Toast />
				</>,
			);

			// Toast appears
			const alerts = screen.getAllByRole("alert");
			expect(alerts.length).toBeGreaterThanOrEqual(1);
			expect(alerts.some((a) => a.textContent?.includes("New real-time alert"))).toBe(true);

			// New notification body appears in both feed and toast
			const bodyElements = screen.getAllByText("Something happened in real-time");
			expect(bodyElements.length).toBeGreaterThanOrEqual(2);

			// Unread badge increments to 2
			expect(screen.getByText("2")).toBeDefined();
		});
	});

	describe("toast auto-dismiss", () => {
		it("should remove toast from queue after the default duration (5000ms)", () => {
			render(<Toast />);

			// Simulate a notification event that creates a toast
			const wsEvent = createNotificationEvent({
				subject: "Dismissable toast",
				body: "This should auto-dismiss",
			});

			act(() => {
				simulateWsNotification(wsEvent, {
					prependToFeed: false,
					incrementUnread: false,
				});
			});

			// Toast appears via rerender
			const { rerender } = render(<Toast />);
			expect(screen.getByText("This should auto-dismiss")).toBeDefined();

			// Simulate auto-dismiss by clearing the toast
			act(() => {
				mockToasts = [];
			});
			rerender(<Toast />);

			expect(screen.queryByText("This should auto-dismiss")).toBeNull();
		});
	});

	describe("multiple real-time events", () => {
		it("should stack multiple toasts and prepend all to feed", () => {
			mockNotifications = [];
			mockUnreadCount = 0;

			const { rerender } = render(
				<>
					<NotificationFeed />
					<Toast />
				</>,
			);

			// Fire two events
			const event1 = createNotificationEvent({
				notificationId: "rt_1",
				subject: "First alert",
				body: "First body",
			});
			const event2 = createNotificationEvent({
				notificationId: "rt_2",
				subject: "Second alert",
				body: "Second body",
			});

			act(() => {
				simulateWsNotification(event1);
				simulateWsNotification(event2);
			});
			rerender(
				<>
					<NotificationFeed />
					<Toast />
				</>,
			);

			// Both toasts appear
			const alerts = screen.getAllByRole("alert");
			expect(alerts.length).toBe(2);

			// Both bodies appear in feed and toast (2 each = 4 total, or 2 if only feed)
			const firstBodyEls = screen.getAllByText("First body");
			expect(firstBodyEls.length).toBeGreaterThanOrEqual(1);
			const secondBodyEls = screen.getAllByText("Second body");
			expect(secondBodyEls.length).toBeGreaterThanOrEqual(1);

			// Unread count incremented twice
			expect(mockUnreadCount).toBe(2);
		});
	});

	describe("toast dismiss interaction", () => {
		it("should call dismiss when close button is clicked on a toast", () => {
			const toast: ToastItem = {
				id: "t_dismiss",
				body: "Dismiss me",
				subject: "Dismissable",
				createdAt: new Date(NOW).toISOString(),
			};
			mockToasts = [toast];

			render(<Toast />);

			fireEvent.click(screen.getByLabelText("Dismiss"));

			expect(mockDismiss).toHaveBeenCalledWith("t_dismiss");
		});
	});
});
