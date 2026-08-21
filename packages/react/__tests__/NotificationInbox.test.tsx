import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationInbox } from "../src/components/NotificationInbox.js";

// ---------------------------------------------------------------------------
// Mock CSS modules
// ---------------------------------------------------------------------------

vi.mock("../src/styles/inbox.module.css", () => ({
	default: new Proxy(
		{},
		{
			get: (_target, prop) => (typeof prop === "string" ? prop : ""),
		},
	),
}));

// ---------------------------------------------------------------------------
// Mock floating-ui (used by OverflowMenu inside NotificationItem)
// ---------------------------------------------------------------------------

vi.mock("@floating-ui/react", () => ({
	useFloating: () => ({
		refs: { setReference: vi.fn(), setFloating: vi.fn() },
		floatingStyles: {},
		context: {},
	}),
	useClick: () => ({}),
	useDismiss: () => ({}),
	useInteractions: () => ({
		getReferenceProps: () => ({}),
		getFloatingProps: () => ({}),
	}),
	autoUpdate: vi.fn(),
	offset: () => ({}),
	flip: () => ({}),
	shift: () => ({}),
	FloatingPortal: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Mock useNotifications
// ---------------------------------------------------------------------------

const mockMarkAllAsRead = vi.fn().mockResolvedValue(undefined);
const mockFetchMore = vi.fn().mockResolvedValue(undefined);
const mockMarkAsRead = vi.fn().mockResolvedValue(undefined);
const mockArchive = vi.fn().mockResolvedValue(undefined);

const NOW = new Date("2026-04-16T12:00:00.000Z").getTime();

function makeNotification(id: string) {
	return {
		id,
		subscriberId: "sub_1",
		event: "order.filled",
		subject: `Notification ${id}`,
		body: "Test body content.",
		createdAt: new Date(NOW - 5 * 60_000).toISOString(),
		readAt: null,
		archivedAt: null,
		snoozedUntil: null,
	};
}

vi.mock("@emito/react-hooks", () => ({
	useNotifications: () => ({
		notifications: [makeNotification("1"), makeNotification("2")],
		isLoading: false,
		hasMore: false,
		fetchMore: mockFetchMore,
		markAsRead: mockMarkAsRead,
		markAsUnread: vi.fn(),
		markAllAsRead: mockMarkAllAsRead,
		archive: mockArchive,
	}),
	useEmitoClient: () => ({
		notifications: {
			snooze: vi.fn(),
		},
		markAllAsRead: mockMarkAllAsRead,
	}),
}));

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationInbox", () => {
	describe("header rendering", () => {
		it("renders the 'Notifications' title", () => {
			render(<NotificationInbox />);
			expect(screen.getByText("Notifications")).toBeDefined();
		});

		it("renders the title as an h2 element", () => {
			render(<NotificationInbox />);
			const heading = screen.getByRole("heading", {
				level: 2,
				name: "Notifications",
			});
			expect(heading).toBeDefined();
		});

		it("renders a 'Mark all read' button", () => {
			render(<NotificationInbox />);
			const button = screen.getByRole("button", { name: "Mark all read" });
			expect(button).toBeDefined();
		});
	});

	describe("mark all as read", () => {
		it("calls markAllAsRead when button is clicked", () => {
			render(<NotificationInbox />);
			fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
			expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1);
		});
	});

	describe("footer", () => {
		it("renders a preferences link when preferencesHref is provided", () => {
			render(<NotificationInbox preferencesHref="/settings/preferences" />);
			const link = screen.getByText("Preferences");
			expect(link).toBeDefined();
			expect(link.tagName).toBe("A");
			expect(link.getAttribute("href")).toBe("/settings/preferences");
		});

		it("renders a preferences button when onPreferencesClick is provided", () => {
			const onClick = vi.fn();
			render(<NotificationInbox onPreferencesClick={onClick} />);
			const button = screen.getByText("Preferences");
			expect(button.tagName).toBe("BUTTON");
		});

		it("fires onPreferencesClick when preferences button is clicked", () => {
			const onClick = vi.fn();
			render(<NotificationInbox onPreferencesClick={onClick} />);
			fireEvent.click(screen.getByText("Preferences"));
			expect(onClick).toHaveBeenCalledTimes(1);
		});

		it("does not render footer when neither preferencesHref nor onPreferencesClick is provided", () => {
			const { container } = render(<NotificationInbox />);
			expect(container.querySelector(".inboxFooter")).toBeNull();
		});

		it("prefers link when both preferencesHref and onPreferencesClick are provided", () => {
			render(<NotificationInbox preferencesHref="/prefs" onPreferencesClick={vi.fn()} />);
			const link = screen.getByText("Preferences");
			expect(link.tagName).toBe("A");
		});
	});

	describe("feed passthrough", () => {
		it("renders notifications from the feed", () => {
			render(<NotificationInbox />);
			expect(screen.getByText("Notification 1")).toBeDefined();
			expect(screen.getByText("Notification 2")).toBeDefined();
		});

		it("fires onNotificationClick when a notification is clicked", () => {
			const onClick = vi.fn();
			render(<NotificationInbox onNotificationClick={onClick} />);
			fireEvent.click(screen.getByText("Notification 1"));
			expect(onClick).toHaveBeenCalledTimes(1);
		});

		it("renders tabs when provided", () => {
			render(
				<NotificationInbox
					tabs={[{ label: "All" }, { label: "Unread", filter: { status: "unread" } }]}
				/>,
			);
			expect(screen.getByText("All")).toBeDefined();
			expect(screen.getByText("Unread")).toBeDefined();
		});
	});

	describe("classNames overrides", () => {
		it("applies root classNames", () => {
			const { container } = render(<NotificationInbox classNames={{ root: "my-root" }} />);
			expect(container.querySelector(".my-root")).not.toBeNull();
		});

		it("applies header classNames", () => {
			const { container } = render(<NotificationInbox classNames={{ header: "my-header" }} />);
			expect(container.querySelector(".my-header")).not.toBeNull();
		});

		it("applies markAllButton classNames", () => {
			render(<NotificationInbox classNames={{ markAllButton: "my-mark-all" }} />);
			const button = screen.getByRole("button", { name: "Mark all read" });
			expect(button.className).toContain("my-mark-all");
		});

		it("applies footer classNames", () => {
			const { container } = render(
				<NotificationInbox preferencesHref="/prefs" classNames={{ footer: "my-footer" }} />,
			);
			expect(container.querySelector(".my-footer")).not.toBeNull();
		});

		it("applies preferencesLink classNames", () => {
			render(
				<NotificationInbox preferencesHref="/prefs" classNames={{ preferencesLink: "my-link" }} />,
			);
			const link = screen.getByText("Preferences");
			expect(link.className).toContain("my-link");
		});

		it("passes classNames through to NotificationFeed", () => {
			const { container } = render(<NotificationInbox classNames={{ feed: "my-feed" }} />);
			expect(container.querySelector(".my-feed")).not.toBeNull();
		});
	});

	describe("ref forwarding", () => {
		it("forwards ref to the root div", () => {
			const ref = createRef<HTMLDivElement>();
			render(<NotificationInbox ref={ref} />);
			expect(ref.current).not.toBeNull();
			expect(ref.current!.tagName).toBe("DIV");
			expect(ref.current!.className).toContain("inboxRoot");
		});
	});
});
