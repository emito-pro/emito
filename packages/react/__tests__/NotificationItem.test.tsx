import type { NotificationItem as NotificationItemType } from "@emito/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationItem } from "../src/components/NotificationItem.js";

// Mock react-hooks so useEmitoClient doesn't throw (needed by OverflowMenu → SnoozePicker)
vi.mock("@emito/react-hooks", () => ({
	useEmitoClient: () => ({
		notifications: {
			snooze: vi.fn(),
		},
	}),
}));

// Mock CSS modules
vi.mock("../src/styles/inbox.module.css", () => ({
	default: new Proxy(
		{},
		{
			get: (_target, prop) => (typeof prop === "string" ? prop : ""),
		},
	),
}));

// Mock floating-ui (OverflowMenu uses it)
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

// Freeze time for relative-time formatting
const NOW = new Date("2026-04-16T12:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

function makeNotification(overrides?: Partial<NotificationItemType>): NotificationItemType {
	return {
		id: "ntf_1",
		subscriberId: "sub_1",
		event: "order.filled",
		subject: "Order #1234 Filled",
		body: "Your buy order for 1.5 BTC has been filled successfully.",
		avatar: "https://example.com/avatar.png",
		actionUrl: "https://example.com/order/1234",
		createdAt: new Date(NOW - 5 * 60_000).toISOString(),
		readAt: null,
		archivedAt: null,
		snoozedUntil: null,
		...overrides,
	};
}

describe("NotificationItem", () => {
	it("renders subject, body, and timestamp", () => {
		render(<NotificationItem notification={makeNotification()} />);

		expect(screen.getByText("Order #1234 Filled")).toBeDefined();
		expect(
			screen.getByText("Your buy order for 1.5 BTC has been filled successfully."),
		).toBeDefined();
		expect(screen.getByText("5m ago")).toBeDefined();
	});

	it("renders avatar image when notification has avatar URL", () => {
		const { container } = render(<NotificationItem notification={makeNotification()} />);

		// img uses alt="" (decorative), so accessible role is "presentation" — query via DOM
		const img = container.querySelector("img");
		expect(img).not.toBeNull();
		expect(img!.getAttribute("src")).toBe("https://example.com/avatar.png");
	});

	it("renders avatar fallback when no avatar URL", () => {
		render(<NotificationItem notification={makeNotification({ avatar: undefined })} />);

		// No <img> tag, but there should be a fallback SVG
		const imgs = screen.queryAllByRole("img", { hidden: true });
		expect(imgs.length).toBe(0);
	});

	it("renders subject with bold styling when unread (readAt is null)", () => {
		const { container } = render(
			<NotificationItem notification={makeNotification({ readAt: null })} />,
		);

		const subject = container.querySelector(".subjectUnread");
		expect(subject).not.toBeNull();
		expect(subject!.textContent).toBe("Order #1234 Filled");
	});

	it("renders subject without bold styling when read", () => {
		const { container } = render(
			<NotificationItem
				notification={makeNotification({
					readAt: "2026-04-16T10:00:00.000Z",
				})}
			/>,
		);

		const subject = container.querySelector(".subjectUnread");
		expect(subject).toBeNull();
	});

	it("renders unread dot when readAt is null", () => {
		const { container } = render(
			<NotificationItem notification={makeNotification({ readAt: null })} />,
		);

		expect(container.querySelector(".unreadDot")).not.toBeNull();
	});

	it("does not render unread dot when read", () => {
		const { container } = render(
			<NotificationItem
				notification={makeNotification({
					readAt: "2026-04-16T10:00:00.000Z",
				})}
			/>,
		);

		expect(container.querySelector(".unreadDot")).toBeNull();
	});

	it("renders primaryAction button when present", () => {
		render(
			<NotificationItem
				notification={makeNotification({
					primaryAction: { label: "View Order", url: "https://example.com" },
				})}
			/>,
		);

		expect(screen.getByText("View Order")).toBeDefined();
	});

	it("renders secondaryAction button when present", () => {
		render(
			<NotificationItem
				notification={makeNotification({
					secondaryAction: { label: "Archive", url: "https://example.com" },
				})}
			/>,
		);

		expect(screen.getByText("Archive")).toBeDefined();
	});

	it("does not render action buttons when no actions", () => {
		render(
			<NotificationItem
				notification={makeNotification({
					primaryAction: undefined,
					secondaryAction: undefined,
				})}
			/>,
		);

		const buttons = screen.queryAllByRole("button");
		// item div has role="button" (1) + overflow trigger (1) = 2 max when no inline actions
		expect(buttons.length).toBeLessThanOrEqual(2);
	});

	it("fires onNotificationClick when item is clicked", () => {
		const notification = makeNotification();
		const onClick = vi.fn();

		render(<NotificationItem notification={notification} onClick={onClick} />);

		fireEvent.click(screen.getByText("Order #1234 Filled"));
		expect(onClick).toHaveBeenCalledWith(notification);
	});

	it("applies classNames overrides", () => {
		const { container } = render(
			<NotificationItem
				notification={makeNotification()}
				classNames={{ item: "my-item", subject: "my-subject" }}
			/>,
		);

		const item = container.querySelector(".my-item");
		expect(item).not.toBeNull();
		const subject = container.querySelector(".my-subject");
		expect(subject).not.toBeNull();
	});

	it("uses renderAvatar render prop when provided", () => {
		render(
			<NotificationItem
				notification={makeNotification()}
				renderAvatar={() => <span data-testid="custom-avatar">A</span>}
			/>,
		);

		expect(screen.getByTestId("custom-avatar")).toBeDefined();
	});

	it("falls back to event name when subject is not set", () => {
		render(<NotificationItem notification={makeNotification({ subject: undefined })} />);

		expect(screen.getByText("order.filled")).toBeDefined();
	});

	it("renders overflow menu trigger", () => {
		render(<NotificationItem notification={makeNotification()} />);

		const trigger = screen.getByLabelText("More actions");
		expect(trigger).toBeDefined();
	});
});
