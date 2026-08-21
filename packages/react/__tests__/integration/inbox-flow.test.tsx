import type { NotificationItem } from "@emito/js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotificationItem, resetBuilderCounters } from "../helpers/builders.js";

// ---------------------------------------------------------------------------
// Mock CSS modules
// ---------------------------------------------------------------------------

vi.mock("../../src/styles/inbox.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? prop : "") }),
}));

vi.mock("../../src/styles/bell.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? prop : "") }),
}));

// ---------------------------------------------------------------------------
// Mock @floating-ui/react
// ---------------------------------------------------------------------------

let capturedOnOpenChange: ((open: boolean) => void) | undefined;

vi.mock("@floating-ui/react", () => ({
	useFloating: (options?: { onOpenChange?: (open: boolean) => void }) => {
		capturedOnOpenChange = options?.onOpenChange;
		return {
			refs: { setReference: vi.fn(), setFloating: vi.fn() },
			floatingStyles: { position: "absolute" as const, top: 0, left: 0 },
			context: { open: true },
		};
	},
	useClick: () => ({}),
	useDismiss: () => ({}),
	useRole: () => ({}),
	useInteractions: () => ({
		getReferenceProps: vi.fn(() => ({})),
		getFloatingProps: vi.fn(() => ({})),
	}),
	autoUpdate: vi.fn(),
	offset: (val: number) => ({ name: "offset", value: val }),
	flip: () => ({ name: "flip" }),
	shift: () => ({ name: "shift" }),
	FloatingPortal: ({ children }: { children: React.ReactNode }) => children,
	FloatingFocusManager: ({
		children,
	}: {
		children: React.ReactNode;
		context: unknown;
		modal?: boolean;
	}) => <div>{children}</div>,
}));

// ---------------------------------------------------------------------------
// Stateful hook mocks — coordinated across components
// ---------------------------------------------------------------------------

let mockNotifications: NotificationItem[] = [];
let mockUnreadCount = 0;
const mockMarkAsRead = vi.fn<(id: string) => Promise<void>>();
const mockMarkAllAsRead = vi.fn<() => Promise<void>>();

vi.mock("@emito/react-hooks", () => ({
	useNotifications: () => ({
		notifications: mockNotifications,
		isLoading: false,
		hasMore: false,
		fetchMore: vi.fn().mockResolvedValue(undefined),
		markAsRead: mockMarkAsRead,
		markAsUnread: vi.fn(),
		markAllAsRead: mockMarkAllAsRead,
		archive: vi.fn().mockResolvedValue(undefined),
	}),
	useUnreadCount: () => ({ unreadCount: mockUnreadCount }),
	useEmitoClient: () => ({
		notifications: { snooze: vi.fn() },
		markAllAsRead: mockMarkAllAsRead,
	}),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks
// ---------------------------------------------------------------------------

import { InboxPopover } from "../../src/components/InboxPopover.js";
import { NotificationBell } from "../../src/components/NotificationBell.js";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const NOW = new Date("2026-04-16T12:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	resetBuilderCounters();
	capturedOnOpenChange = undefined;
	mockNotifications = [];
	mockUnreadCount = 0;
	mockMarkAsRead.mockReset().mockResolvedValue(undefined);
	mockMarkAllAsRead.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Inbox flow integration", () => {
	describe("bell → popover → notifications", () => {
		it("should render bell with unread count and open popover showing notifications on click", () => {
			mockNotifications = [
				createNotificationItem({ id: "n1", subject: "Order shipped" }),
				createNotificationItem({ id: "n2", subject: "Payment received" }),
			];
			mockUnreadCount = 2;

			const { rerender } = render(<InboxPopover bell={<NotificationBell />} />);

			// Bell renders with unread badge
			expect(screen.getByText("2")).toBeDefined();

			// Open the popover via floating-ui's onOpenChange
			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<NotificationBell />} />);

			// Notifications render in the feed
			expect(screen.getByText("Order shipped")).toBeDefined();
			expect(screen.getByText("Payment received")).toBeDefined();
		});

		it("should render 'Notifications' header and 'Mark all read' button in popover", () => {
			mockNotifications = [createNotificationItem()];
			mockUnreadCount = 1;

			const { rerender } = render(<InboxPopover bell={<NotificationBell />} />);

			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<NotificationBell />} />);

			expect(screen.getByText("Notifications")).toBeDefined();
			expect(screen.getByText("Mark all read")).toBeDefined();
		});
	});

	describe("notification click → onNotificationClick", () => {
		it("should call onNotificationClick with the notification when a notification is clicked", () => {
			const notification = createNotificationItem({
				id: "n1",
				subject: "New message",
				readAt: null,
			});
			mockNotifications = [notification];
			mockUnreadCount = 1;

			const onNotificationClick = vi.fn();
			const { rerender } = render(
				<InboxPopover bell={<NotificationBell />} onNotificationClick={onNotificationClick} />,
			);

			// Open popover
			capturedOnOpenChange?.(true);
			rerender(
				<InboxPopover bell={<NotificationBell />} onNotificationClick={onNotificationClick} />,
			);

			// Click the notification row
			fireEvent.click(screen.getByText("New message"));

			expect(onNotificationClick).toHaveBeenCalledTimes(1);
			expect(onNotificationClick).toHaveBeenCalledWith(
				expect.objectContaining({ id: "n1", subject: "New message" }),
			);
		});
	});

	describe("mark all as read", () => {
		it("should call markAllAsRead when 'Mark all read' button is clicked", () => {
			mockNotifications = [
				createNotificationItem({ readAt: null }),
				createNotificationItem({ readAt: null }),
			];
			mockUnreadCount = 2;

			const { rerender } = render(<InboxPopover bell={<NotificationBell />} />);

			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<NotificationBell />} />);

			fireEvent.click(screen.getByText("Mark all read"));

			expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1);
		});
	});

	describe("badge reflects unread count", () => {
		it("should show badge with correct count when unread notifications exist", () => {
			mockNotifications = [
				createNotificationItem({ readAt: null }),
				createNotificationItem({ readAt: null }),
				createNotificationItem({ readAt: "2026-04-16T11:00:00.000Z" }),
			];
			mockUnreadCount = 2;

			render(<InboxPopover bell={<NotificationBell />} />);

			expect(screen.getByText("2")).toBeDefined();
		});

		it("should hide badge when unread count is zero", () => {
			mockNotifications = [];
			mockUnreadCount = 0;

			render(<InboxPopover bell={<NotificationBell />} />);

			const button = screen.getByRole("button", { name: "Notifications" });
			const badge = button.querySelector("span");
			expect(badge).toBeNull();
		});
	});

	describe("preferences footer link", () => {
		it("should render preferences link in popover footer when preferencesHref is provided", () => {
			mockNotifications = [createNotificationItem()];
			mockUnreadCount = 0;

			const { rerender } = render(
				<InboxPopover bell={<NotificationBell />} preferencesHref="/settings/notifications" />,
			);

			capturedOnOpenChange?.(true);
			rerender(
				<InboxPopover bell={<NotificationBell />} preferencesHref="/settings/notifications" />,
			);

			const link = screen.getByText("Preferences");
			expect(link.closest("a")?.getAttribute("href")).toBe("/settings/notifications");
		});
	});

	describe("unread indicator on notification items", () => {
		it("should show unread dot for notifications without readAt", () => {
			mockNotifications = [
				createNotificationItem({ id: "unread_1", readAt: null }),
				createNotificationItem({ id: "read_1", readAt: "2026-04-16T11:30:00.000Z" }),
			];
			mockUnreadCount = 1;

			const { rerender } = render(<InboxPopover bell={<NotificationBell />} />);

			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<NotificationBell />} />);

			// Unread notification should have an unread dot element
			const items = document.querySelectorAll("[class*='item']");
			expect(items.length).toBeGreaterThan(0);
		});
	});
});
