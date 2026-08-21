import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxPopover } from "../src/components/InboxPopover.js";

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
// Mock floating-ui
// ---------------------------------------------------------------------------

const mockSetReference = vi.fn();
const mockSetFloating = vi.fn();
let capturedPlacement: string | undefined;
let capturedMiddleware: unknown[] | undefined;
let capturedOnOpenChange: ((open: boolean) => void) | undefined;

const mockGetReferenceProps = vi.fn(() => ({ "data-floating-reference": true }));
const mockGetFloatingProps = vi.fn(() => ({ "data-floating-popup": true }));

vi.mock("@floating-ui/react", () => ({
	useFloating: (options?: {
		placement?: string;
		middleware?: unknown[];
		onOpenChange?: (open: boolean) => void;
	}) => {
		capturedPlacement = options?.placement;
		capturedMiddleware = options?.middleware;
		capturedOnOpenChange = options?.onOpenChange;
		return {
			refs: { setReference: mockSetReference, setFloating: mockSetFloating },
			floatingStyles: { position: "absolute" as const, top: 0, left: 0 },
			context: { open: true },
		};
	},
	useClick: () => ({}),
	useDismiss: () => ({}),
	useRole: () => ({}),
	useInteractions: () => ({
		getReferenceProps: mockGetReferenceProps,
		getFloatingProps: mockGetFloatingProps,
	}),
	autoUpdate: vi.fn(),
	offset: (val: number) => ({ name: "offset", value: val }),
	flip: () => ({ name: "flip" }),
	shift: () => ({ name: "shift" }),
	FloatingPortal: ({ children }: { children: React.ReactNode }) => children,
	FloatingFocusManager: ({
		children,
		modal,
	}: {
		children: React.ReactNode;
		context: unknown;
		modal?: boolean;
	}) => (
		<div data-testid="focus-manager" data-modal={String(modal ?? true)}>
			{children}
		</div>
	),
}));

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

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
		notifications: [makeNotification("1")],
		isLoading: false,
		hasMore: false,
		fetchMore: vi.fn().mockResolvedValue(undefined),
		markAsRead: vi.fn().mockResolvedValue(undefined),
		markAsUnread: vi.fn(),
		markAllAsRead: vi.fn().mockResolvedValue(undefined),
		archive: vi.fn().mockResolvedValue(undefined),
	}),
	useEmitoClient: () => ({
		notifications: {
			snooze: vi.fn(),
		},
	}),
}));

// ---------------------------------------------------------------------------
// Test bell trigger
// ---------------------------------------------------------------------------

const TestBell = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
	function TestBell(props, ref) {
		return (
			<button ref={ref} type="button" {...props}>
				Bell
			</button>
		);
	},
);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	capturedPlacement = undefined;
	capturedMiddleware = undefined;
	capturedOnOpenChange = undefined;
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InboxPopover", () => {
	describe("trigger rendering", () => {
		it("renders the bell trigger element", () => {
			render(<InboxPopover bell={<TestBell />} />);
			expect(screen.getByText("Bell")).toBeDefined();
		});

		it("passes interaction props to the bell trigger", () => {
			render(<InboxPopover bell={<TestBell />} />);
			const bell = screen.getByText("Bell");
			expect(bell.getAttribute("data-floating-reference")).toBe("true");
		});
	});

	describe("popover content", () => {
		it("does not render NotificationInbox when closed", () => {
			render(<InboxPopover bell={<TestBell />} />);
			expect(screen.queryByText("Notifications")).toBeNull();
			expect(screen.queryByText("Mark all read")).toBeNull();
		});

		it("renders NotificationInbox with header and notifications when open", () => {
			const { rerender } = render(<InboxPopover bell={<TestBell />} />);
			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<TestBell />} />);

			expect(screen.getByText("Notifications")).toBeDefined();
			expect(screen.getByText("Mark all read")).toBeDefined();
			expect(screen.getByText("Notification 1")).toBeDefined();
		});
	});

	describe("placement", () => {
		it("defaults to bottom-end", () => {
			render(<InboxPopover bell={<TestBell />} />);
			expect(capturedPlacement).toBe("bottom-end");
		});

		it("accepts a custom placement", () => {
			render(<InboxPopover bell={<TestBell />} placement="top-start" />);
			expect(capturedPlacement).toBe("top-start");
		});
	});

	describe("middleware", () => {
		it("configures offset(8), flip(), shift() in correct order", () => {
			render(<InboxPopover bell={<TestBell />} />);
			expect(capturedMiddleware).toBeDefined();
			expect(capturedMiddleware).toHaveLength(3);

			const middleware = capturedMiddleware as Array<{
				name: string;
				value?: number;
			}>;
			expect(middleware[0]!.name).toBe("offset");
			expect(middleware[0]!.value).toBe(8);
			expect(middleware[1]!.name).toBe("flip");
			expect(middleware[2]!.name).toBe("shift");
		});
	});

	describe("focus management", () => {
		it("renders FloatingFocusManager with modal=false when open", () => {
			const { rerender } = render(<InboxPopover bell={<TestBell />} />);

			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<TestBell />} />);

			const focusManager = screen.getByTestId("focus-manager");
			expect(focusManager.getAttribute("data-modal")).toBe("false");
		});

		it("does not render FloatingFocusManager when closed", () => {
			render(<InboxPopover bell={<TestBell />} />);
			expect(screen.queryByTestId("focus-manager")).toBeNull();
		});
	});

	describe("onOpenChange callback", () => {
		it("calls onOpenChange when popover state changes", () => {
			const onOpenChange = vi.fn();
			render(<InboxPopover bell={<TestBell />} onOpenChange={onOpenChange} />);

			// Simulate Floating UI triggering open
			capturedOnOpenChange?.(true);
			expect(onOpenChange).toHaveBeenCalledWith(true);

			capturedOnOpenChange?.(false);
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	describe("classNames overrides", () => {
		it("does not render popover container when closed", () => {
			render(<InboxPopover bell={<TestBell />} classNames={{ popover: "my-popover" }} />);
			expect(document.querySelector(".my-popover")).toBeNull();
		});

		it("applies popover classNames to the floating container when open", () => {
			const { rerender } = render(
				<InboxPopover bell={<TestBell />} classNames={{ popover: "my-popover" }} />,
			);

			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<TestBell />} classNames={{ popover: "my-popover" }} />);

			expect(document.querySelector(".my-popover")).not.toBeNull();
		});
	});

	describe("prop passthrough", () => {
		it("passes preferencesHref through to NotificationInbox when open", () => {
			const { rerender } = render(<InboxPopover bell={<TestBell />} preferencesHref="/settings" />);

			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<TestBell />} preferencesHref="/settings" />);

			const link = screen.getByText("Preferences");
			expect(link.tagName).toBe("A");
			expect(link.getAttribute("href")).toBe("/settings");
		});

		it("passes tabs through to NotificationInbox when open", () => {
			const { rerender } = render(
				<InboxPopover bell={<TestBell />} tabs={[{ label: "All" }, { label: "Unread" }]} />,
			);

			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<TestBell />} tabs={[{ label: "All" }, { label: "Unread" }]} />);

			expect(screen.getByText("All")).toBeDefined();
			expect(screen.getByText("Unread")).toBeDefined();
		});
	});

	describe("ref forwarding", () => {
		it("forwards ref to the floating container when open", () => {
			const ref = createRef<HTMLDivElement>();
			const { rerender } = render(<InboxPopover bell={<TestBell />} ref={ref} />);

			capturedOnOpenChange?.(true);
			rerender(<InboxPopover bell={<TestBell />} ref={ref} />);

			expect(ref.current).not.toBeNull();
			expect(ref.current!.tagName).toBe("DIV");
		});
	});
});
