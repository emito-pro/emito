import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverflowMenu } from "../src/components/OverflowMenu.js";

// Mock CSS modules
vi.mock("../src/styles/inbox.module.css", () => ({
	default: new Proxy(
		{},
		{
			get: (_target, prop) => (typeof prop === "string" ? prop : ""),
		},
	),
}));

// Mock react-hooks for SnoozePicker (rendered when snooze action is active)
const mockSnooze = vi.fn();
vi.mock("@emito/react-hooks", () => ({
	useEmitoClient: () => ({
		notifications: {
			snooze: mockSnooze,
		},
	}),
}));

// Smart floating-ui mock: useClick wires onClick → onOpenChange(true) so the menu opens
vi.mock("@floating-ui/react", () => ({
	useFloating: ({ onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void }) => ({
		refs: { setReference: vi.fn(), setFloating: vi.fn() },
		floatingStyles: {},
		context: { onOpenChange },
	}),
	useClick: (context: { onOpenChange?: (open: boolean) => void }) => ({
		onClick: () => context.onOpenChange?.(true),
	}),
	useDismiss: () => ({}),
	useInteractions: (interactions: Array<Record<string, unknown>>) => ({
		getReferenceProps: () => Object.assign({}, ...interactions),
		getFloatingProps: () => ({}),
	}),
	autoUpdate: vi.fn(),
	offset: () => ({}),
	flip: () => ({}),
	shift: () => ({}),
	FloatingPortal: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(() => {
	vi.clearAllMocks();
	cleanup();
});

describe("OverflowMenu", () => {
	it("renders the trigger button", () => {
		render(<OverflowMenu notificationId="ntf_1" />);
		expect(screen.getByLabelText("More actions")).toBeDefined();
	});

	it("opens the menu when trigger is clicked", () => {
		render(<OverflowMenu notificationId="ntf_1" />);

		fireEvent.click(screen.getByLabelText("More actions"));

		expect(screen.getByText("Mark as read")).toBeDefined();
		expect(screen.getByText("Archive")).toBeDefined();
		expect(screen.getByText("Snooze")).toBeDefined();
	});

	it("does not render menu before trigger click", () => {
		render(<OverflowMenu notificationId="ntf_1" />);

		expect(screen.queryByText("Mark as read")).toBeNull();
		expect(screen.queryByText("Archive")).toBeNull();
	});

	it("calls onMarkAsRead with notificationId when Mark as read is clicked", () => {
		const onMarkAsRead = vi.fn();
		render(<OverflowMenu notificationId="ntf_abc" onMarkAsRead={onMarkAsRead} />);

		fireEvent.click(screen.getByLabelText("More actions"));
		fireEvent.click(screen.getByText("Mark as read"));

		expect(onMarkAsRead).toHaveBeenCalledWith("ntf_abc");
	});

	it("calls onArchive with notificationId when Archive is clicked", () => {
		const onArchive = vi.fn();
		render(<OverflowMenu notificationId="ntf_abc" onArchive={onArchive} />);

		fireEvent.click(screen.getByLabelText("More actions"));
		fireEvent.click(screen.getByText("Archive"));

		expect(onArchive).toHaveBeenCalledWith("ntf_abc");
	});

	it("shows SnoozePicker when Snooze is clicked", () => {
		render(<OverflowMenu notificationId="ntf_1" />);

		fireEvent.click(screen.getByLabelText("More actions"));
		fireEvent.click(screen.getByText("Snooze"));

		expect(screen.getByText("1 hour")).toBeDefined();
		expect(screen.getByText("4 hours")).toBeDefined();
		expect(screen.getByText("Tomorrow")).toBeDefined();
		expect(screen.getByText("Next week")).toBeDefined();
	});

	it("hides Snooze button when SnoozePicker is shown", () => {
		render(<OverflowMenu notificationId="ntf_1" />);

		fireEvent.click(screen.getByLabelText("More actions"));
		fireEvent.click(screen.getByText("Snooze"));

		expect(screen.queryByText("Snooze")).toBeNull();
	});

	it("respects configurable actions — only shows listed actions", () => {
		render(<OverflowMenu notificationId="ntf_1" actions={["markAsRead"]} />);

		fireEvent.click(screen.getByLabelText("More actions"));

		expect(screen.getByText("Mark as read")).toBeDefined();
		expect(screen.queryByText("Archive")).toBeNull();
		expect(screen.queryByText("Snooze")).toBeNull();
	});

	it("shows only archive action when actions=['archive']", () => {
		render(<OverflowMenu notificationId="ntf_1" actions={["archive"]} />);

		fireEvent.click(screen.getByLabelText("More actions"));

		expect(screen.queryByText("Mark as read")).toBeNull();
		expect(screen.getByText("Archive")).toBeDefined();
		expect(screen.queryByText("Snooze")).toBeNull();
	});

	it("applies classNames override to trigger", () => {
		const { container } = render(
			<OverflowMenu notificationId="ntf_1" classNames={{ trigger: "my-trigger" }} />,
		);

		expect(container.querySelector(".my-trigger")).not.toBeNull();
	});
});
