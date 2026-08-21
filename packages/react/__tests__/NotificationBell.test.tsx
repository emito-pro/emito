import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "../src/components/NotificationBell.js";

// ---------------------------------------------------------------------------
// Mock useUnreadCount
// ---------------------------------------------------------------------------

let mockUnreadCount = 0;

vi.mock("@emito/react-hooks", () => ({
	useUnreadCount: () => ({ unreadCount: mockUnreadCount }),
}));

afterEach(() => {
	mockUnreadCount = 0;
	cleanup();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("NotificationBell", () => {
	describe("rendering", () => {
		it("renders a button with default aria-label", () => {
			render(<NotificationBell />);
			const button = screen.getByRole("button", { name: "Notifications" });
			expect(button).toBeDefined();
		});

		it("renders a custom aria-label", () => {
			render(<NotificationBell aria-label="Alerts" />);
			const button = screen.getByRole("button", { name: "Alerts" });
			expect(button).toBeDefined();
		});

		it("renders a bell SVG icon by default", () => {
			render(<NotificationBell />);
			const button = screen.getByRole("button");
			const svg = button.querySelector("svg");
			expect(svg).not.toBeNull();
			expect(svg!.getAttribute("aria-hidden")).toBe("true");
		});
	});

	// ---------------------------------------------------------------------------
	// Unread count display
	// ---------------------------------------------------------------------------

	describe("unread count display", () => {
		it("displays the unread count from useUnreadCount", () => {
			mockUnreadCount = 5;
			render(<NotificationBell />);
			expect(screen.getByText("5")).toBeDefined();
		});

		it("displays large count values", () => {
			mockUnreadCount = 42;
			render(<NotificationBell />);
			expect(screen.getByText("42")).toBeDefined();
		});
	});

	// ---------------------------------------------------------------------------
	// Badge visibility (showZero)
	// ---------------------------------------------------------------------------

	describe("badge visibility", () => {
		it("hides badge when count is 0 and showZero is false (default)", () => {
			mockUnreadCount = 0;
			render(<NotificationBell />);
			const button = screen.getByRole("button");
			const badge = button.querySelector("span");
			expect(badge).toBeNull();
		});

		it("shows badge when count is 0 and showZero is true", () => {
			mockUnreadCount = 0;
			render(<NotificationBell showZero />);
			expect(screen.getByText("0")).toBeDefined();
		});

		it("shows badge when count is greater than 0", () => {
			mockUnreadCount = 3;
			render(<NotificationBell />);
			expect(screen.getByText("3")).toBeDefined();
		});
	});

	// ---------------------------------------------------------------------------
	// maxCount overflow
	// ---------------------------------------------------------------------------

	describe("maxCount", () => {
		it("displays '99+' when count exceeds default maxCount of 99", () => {
			mockUnreadCount = 100;
			render(<NotificationBell />);
			expect(screen.getByText("99+")).toBeDefined();
		});

		it("displays '99+' for very large counts", () => {
			mockUnreadCount = 9999;
			render(<NotificationBell />);
			expect(screen.getByText("99+")).toBeDefined();
		});

		it("displays exact count at the maxCount boundary", () => {
			mockUnreadCount = 99;
			render(<NotificationBell />);
			expect(screen.getByText("99")).toBeDefined();
		});

		it("displays custom maxCount overflow", () => {
			mockUnreadCount = 15;
			render(<NotificationBell maxCount={10} />);
			expect(screen.getByText("10+")).toBeDefined();
		});

		it("displays exact count at custom maxCount boundary", () => {
			mockUnreadCount = 10;
			render(<NotificationBell maxCount={10} />);
			expect(screen.getByText("10")).toBeDefined();
		});
	});

	// ---------------------------------------------------------------------------
	// onClick
	// ---------------------------------------------------------------------------

	describe("onClick", () => {
		it("fires onClick handler when clicked", () => {
			const handleClick = vi.fn();
			render(<NotificationBell onClick={handleClick} />);

			fireEvent.click(screen.getByRole("button"));
			expect(handleClick).toHaveBeenCalledTimes(1);
		});
	});

	// ---------------------------------------------------------------------------
	// ref forwarding
	// ---------------------------------------------------------------------------

	describe("ref forwarding", () => {
		it("forwards ref to the button element", () => {
			const ref = createRef<HTMLButtonElement>();
			render(<NotificationBell ref={ref} />);
			expect(ref.current).not.toBeNull();
			expect(ref.current!.tagName).toBe("BUTTON");
		});
	});

	// ---------------------------------------------------------------------------
	// classNames overrides
	// ---------------------------------------------------------------------------

	describe("classNames overrides", () => {
		it("applies classNames.root to the button", () => {
			render(<NotificationBell classNames={{ root: "my-root" }} />);
			const button = screen.getByRole("button");
			expect(button.className).toContain("my-root");
		});

		it("applies className to the button", () => {
			render(<NotificationBell className="custom-class" />);
			const button = screen.getByRole("button");
			expect(button.className).toContain("custom-class");
		});

		it("applies classNames.icon to the SVG", () => {
			render(<NotificationBell classNames={{ icon: "my-icon" }} />);
			const button = screen.getByRole("button");
			const svg = button.querySelector("svg");
			expect(svg!.getAttribute("class")).toContain("my-icon");
		});

		it("applies classNames.badge to the badge span", () => {
			mockUnreadCount = 5;
			render(<NotificationBell classNames={{ badge: "my-badge" }} />);
			const badge = screen.getByText("5");
			expect(badge.className).toContain("my-badge");
		});
	});

	// ---------------------------------------------------------------------------
	// render props
	// ---------------------------------------------------------------------------

	describe("render props", () => {
		it("renderIcon replaces the default SVG icon", () => {
			render(<NotificationBell renderIcon={() => <span data-testid="custom-icon">bell</span>} />);
			expect(screen.getByTestId("custom-icon")).toBeDefined();
			const button = screen.getByRole("button");
			expect(button.querySelector("svg")).toBeNull();
		});

		it("renderIcon receives the current unread count", () => {
			mockUnreadCount = 7;
			render(
				<NotificationBell renderIcon={(count) => <span data-testid="custom-icon">{count}</span>} />,
			);
			expect(screen.getByTestId("custom-icon").textContent).toBe("7");
		});

		it("renderBadge replaces the default badge", () => {
			mockUnreadCount = 3;
			render(
				<NotificationBell
					renderBadge={(count) => <div data-testid="custom-badge">{count} new</div>}
				/>,
			);
			expect(screen.getByTestId("custom-badge").textContent).toBe("3 new");
			// Default badge span should not exist
			expect(screen.queryByText("3")).toBeNull();
		});

		it("renderBadge is not called when badge is hidden (count=0, showZero=false)", () => {
			mockUnreadCount = 0;
			const renderBadge = vi.fn(() => <span>custom</span>);
			render(<NotificationBell renderBadge={renderBadge} />);
			expect(renderBadge).not.toHaveBeenCalled();
		});

		it("renderBadge is called when showZero is true and count is 0", () => {
			mockUnreadCount = 0;
			render(
				<NotificationBell
					showZero
					renderBadge={(count) => <span data-testid="custom-badge">{count}</span>}
				/>,
			);
			expect(screen.getByTestId("custom-badge").textContent).toBe("0");
		});
	});
});
