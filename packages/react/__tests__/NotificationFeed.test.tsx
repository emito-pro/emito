import type { NotificationItem as NotificationItemType } from "@emito/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationFeed } from "../src/components/NotificationFeed.js";

// Mock CSS modules
vi.mock("../src/styles/inbox.module.css", () => ({
	default: new Proxy(
		{},
		{
			get: (_target, prop) => (typeof prop === "string" ? prop : ""),
		},
	),
}));

// Mock floating-ui (used by OverflowMenu inside NotificationItem)
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

const NOW = new Date("2026-04-16T12:00:00.000Z").getTime();

// Mock useNotifications and useEmitoClient
const mockFetchMore = vi.fn().mockResolvedValue(undefined);
const mockMarkAsRead = vi.fn().mockResolvedValue(undefined);
const mockArchive = vi.fn().mockResolvedValue(undefined);

const mockUseNotifications = vi.fn();

vi.mock("@emito/react-hooks", () => ({
	useNotifications: (...args: unknown[]) => mockUseNotifications(...args),
	useEmitoClient: () => ({
		notifications: {
			snooze: vi.fn(),
		},
	}),
}));

function makeNotification(
	id: string,
	overrides?: Partial<NotificationItemType>,
): NotificationItemType {
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
		...overrides,
	};
}

const DEFAULT_HOOK_RESULT = {
	notifications: [makeNotification("1"), makeNotification("2")],
	isLoading: false,
	hasMore: false,
	fetchMore: mockFetchMore,
	markAsRead: mockMarkAsRead,
	markAsUnread: vi.fn(),
	markAllAsRead: vi.fn(),
	archive: mockArchive,
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	mockUseNotifications.mockReturnValue(DEFAULT_HOOK_RESULT);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	cleanup();
});

describe("NotificationFeed", () => {
	it("renders a list of notifications", () => {
		render(<NotificationFeed />);

		expect(screen.getByText("Notification 1")).toBeDefined();
		expect(screen.getByText("Notification 2")).toBeDefined();
	});

	it("renders skeleton rows during loading state", () => {
		mockUseNotifications.mockReturnValue({
			...DEFAULT_HOOK_RESULT,
			notifications: [],
			isLoading: true,
		});

		const { container } = render(<NotificationFeed />);
		const skeletons = container.querySelectorAll(".skeleton");
		expect(skeletons.length).toBe(3);
	});

	it("renders empty state when no notifications and not loading", () => {
		mockUseNotifications.mockReturnValue({
			...DEFAULT_HOOK_RESULT,
			notifications: [],
			isLoading: false,
		});

		render(<NotificationFeed />);
		expect(screen.getByText("No notifications yet")).toBeDefined();
	});

	it("does not render empty state during loading", () => {
		mockUseNotifications.mockReturnValue({
			...DEFAULT_HOOK_RESULT,
			notifications: [],
			isLoading: true,
		});

		render(<NotificationFeed />);
		expect(screen.queryByText("No notifications yet")).toBeNull();
	});

	describe("tabs", () => {
		it("renders tab bar when tabs prop is provided", () => {
			render(
				<NotificationFeed
					tabs={[{ label: "All" }, { label: "Unread", filter: { status: "unread" } }]}
				/>,
			);

			expect(screen.getByText("All")).toBeDefined();
			expect(screen.getByText("Unread")).toBeDefined();
		});

		it("marks the first tab as active by default", () => {
			render(<NotificationFeed tabs={[{ label: "All" }, { label: "Unread" }]} />);

			const allTab = screen.getByText("All");
			expect(allTab.getAttribute("aria-selected")).toBe("true");
		});

		it("switches active tab on click and passes filter to hook", () => {
			render(
				<NotificationFeed
					tabs={[{ label: "All" }, { label: "Unread", filter: { status: "unread" } }]}
				/>,
			);

			fireEvent.click(screen.getByText("Unread"));

			// After clicking "Unread" tab, the hook should have been called with the filter
			const lastCall = mockUseNotifications.mock.calls[mockUseNotifications.mock.calls.length - 1]!;
			expect(lastCall[0]).toEqual({ status: "unread" });
		});

		it("does not render tab bar when tabs is not provided", () => {
			render(<NotificationFeed />);

			const tabBar = screen.queryByRole("tablist");
			expect(tabBar).toBeNull();
		});
	});

	describe("infinite scroll", () => {
		it("calls fetchMore when scrolled near bottom and hasMore is true", () => {
			mockUseNotifications.mockReturnValue({
				...DEFAULT_HOOK_RESULT,
				hasMore: true,
			});

			const { container } = render(<NotificationFeed />);
			const feed = container.querySelector(".feed");

			// Simulate scroll near bottom
			Object.defineProperty(feed, "scrollHeight", { value: 1000 });
			Object.defineProperty(feed, "scrollTop", { value: 850 });
			Object.defineProperty(feed, "clientHeight", { value: 100 });

			fireEvent.scroll(feed!);

			expect(mockFetchMore).toHaveBeenCalledTimes(1);
		});

		it("does not call fetchMore when not near bottom", () => {
			mockUseNotifications.mockReturnValue({
				...DEFAULT_HOOK_RESULT,
				hasMore: true,
			});

			const { container } = render(<NotificationFeed />);
			const feed = container.querySelector(".feed");

			Object.defineProperty(feed, "scrollHeight", { value: 1000 });
			Object.defineProperty(feed, "scrollTop", { value: 200 });
			Object.defineProperty(feed, "clientHeight", { value: 100 });

			fireEvent.scroll(feed!);

			expect(mockFetchMore).not.toHaveBeenCalled();
		});

		it("does not call fetchMore when hasMore is false", () => {
			mockUseNotifications.mockReturnValue({
				...DEFAULT_HOOK_RESULT,
				hasMore: false,
			});

			const { container } = render(<NotificationFeed />);
			const feed = container.querySelector(".feed");

			Object.defineProperty(feed, "scrollHeight", { value: 1000 });
			Object.defineProperty(feed, "scrollTop", { value: 850 });
			Object.defineProperty(feed, "clientHeight", { value: 100 });

			fireEvent.scroll(feed!);

			expect(mockFetchMore).not.toHaveBeenCalled();
		});
	});

	describe("callbacks", () => {
		it("fires onNotificationClick when an item is clicked", () => {
			const onClick = vi.fn();

			render(<NotificationFeed onNotificationClick={onClick} />);

			fireEvent.click(screen.getByText("Notification 1"));
			expect(onClick).toHaveBeenCalledTimes(1);
			expect(onClick.mock.calls[0]![0].id).toBe("1");
		});
	});

	describe("render props", () => {
		it("uses renderNotification when provided", () => {
			render(
				<NotificationFeed
					renderNotification={(n, { onClick }) => (
						<div data-testid={`custom-${n.id}`} onClick={onClick}>
							Custom: {n.subject}
						</div>
					)}
				/>,
			);

			expect(screen.getByTestId("custom-1")).toBeDefined();
			expect(screen.getByText("Custom: Notification 1")).toBeDefined();
		});

		it("fires onNotificationClick through render prop onClick helper", () => {
			const onClick = vi.fn();

			render(
				<NotificationFeed
					onNotificationClick={onClick}
					renderNotification={(n, { onClick: handleClick }) => (
						<div data-testid={`custom-${n.id}`} onClick={handleClick}>
							{n.subject}
						</div>
					)}
				/>,
			);

			fireEvent.click(screen.getByTestId("custom-1"));
			expect(onClick).toHaveBeenCalledTimes(1);
		});
	});

	describe("classNames", () => {
		it("applies feed classNames override", () => {
			const { container } = render(<NotificationFeed classNames={{ feed: "my-feed" }} />);

			expect(container.querySelector(".my-feed")).not.toBeNull();
		});

		it("applies skeleton classNames override during loading", () => {
			mockUseNotifications.mockReturnValue({
				...DEFAULT_HOOK_RESULT,
				notifications: [],
				isLoading: true,
			});

			const { container } = render(<NotificationFeed classNames={{ skeleton: "my-skeleton" }} />);

			const skeletons = container.querySelectorAll(".my-skeleton");
			expect(skeletons.length).toBe(3);
		});
	});
});
