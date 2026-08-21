import type { ToastItem as ToastItemType } from "@emito/react-hooks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastItem } from "../src/components/ToastItem.js";

// ---------------------------------------------------------------------------
// Mock CSS modules
// ---------------------------------------------------------------------------

vi.mock("../src/styles/toast.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => `toast_${String(prop)}` }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Relaxed action shape so tests can omit `url` to exercise the no-URL path. */
type RelaxedAction = { label: string; url?: string };

type ToastOverrides = Partial<
	Omit<ToastItemType, "primaryAction" | "secondaryAction">
> & {
	primaryAction?: RelaxedAction;
	secondaryAction?: RelaxedAction;
};

function makeToast(overrides: ToastOverrides = {}): ToastItemType {
	const { primaryAction, secondaryAction, ...rest } = overrides;
	const base: ToastItemType = {
		id: "toast-1",
		body: "Your order was filled",
		subject: "Order Filled",
		createdAt: "2026-04-16T12:00:00.000Z",
	};
	// Build via conditional spread so undefined-valued keys are omitted, and
	// cast the relaxed action shapes back to the component's action type — the
	// component tolerates a missing `url` at runtime (handleActionClick guards
	// on `toast.primaryAction?.url`), which these tests deliberately exercise.
	return {
		...base,
		...rest,
		...(primaryAction !== undefined
			? { primaryAction: primaryAction as ToastItemType["primaryAction"] }
			: {}),
		...(secondaryAction !== undefined
			? { secondaryAction: secondaryAction as ToastItemType["secondaryAction"] }
			: {}),
	};
}

afterEach(() => {
	cleanup();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ToastItem", () => {
	describe("rendering", () => {
		it("renders subject and body text", () => {
			render(<ToastItem toast={makeToast()} onClose={vi.fn()} />);
			expect(screen.getByText("Order Filled")).toBeDefined();
			expect(screen.getByText("Your order was filled")).toBeDefined();
		});

		it("renders with role=alert for accessibility", () => {
			render(<ToastItem toast={makeToast()} onClose={vi.fn()} />);
			expect(screen.getByRole("alert")).toBeDefined();
		});

		it("renders body without subject when subject is undefined", () => {
			render(<ToastItem toast={makeToast({ subject: undefined })} onClose={vi.fn()} />);
			expect(screen.getByText("Your order was filled")).toBeDefined();
			expect(screen.queryByText("Order Filled")).toBeNull();
		});
	});

	// ---------------------------------------------------------------------------
	// Avatar
	// ---------------------------------------------------------------------------

	describe("avatar", () => {
		it("renders avatar image when avatar URL is provided", () => {
			render(
				<ToastItem
					toast={makeToast({ avatar: "https://example.com/avatar.png" })}
					onClose={vi.fn()}
				/>,
			);
			const img = screen.getByRole("alert").querySelector("img");
			expect(img).not.toBeNull();
			expect(img!.getAttribute("src")).toBe("https://example.com/avatar.png");
		});

		it("renders fallback avatar when no avatar URL", () => {
			render(<ToastItem toast={makeToast()} onClose={vi.fn()} />);
			const alert = screen.getByRole("alert");
			const svg = alert.querySelector("svg");
			expect(svg).not.toBeNull();
		});
	});

	// ---------------------------------------------------------------------------
	// Close button
	// ---------------------------------------------------------------------------

	describe("close button", () => {
		it("calls onClose with toast id when clicked", () => {
			const onClose = vi.fn();
			render(<ToastItem toast={makeToast()} onClose={onClose} />);
			fireEvent.click(screen.getByLabelText("Dismiss"));
			expect(onClose).toHaveBeenCalledWith("toast-1");
		});

		it("calls stopPropagation to prevent body click", () => {
			const onClose = vi.fn();
			const onToastClick = vi.fn();
			render(<ToastItem toast={makeToast()} onClose={onClose} onToastClick={onToastClick} />);
			fireEvent.click(screen.getByLabelText("Dismiss"));
			expect(onClose).toHaveBeenCalledTimes(1);
			expect(onToastClick).not.toHaveBeenCalled();
		});
	});

	// ---------------------------------------------------------------------------
	// Body click
	// ---------------------------------------------------------------------------

	describe("body click", () => {
		it("fires onToastClick with the toast when body is clicked", () => {
			const toast = makeToast();
			const onToastClick = vi.fn();
			render(<ToastItem toast={toast} onClose={vi.fn()} onToastClick={onToastClick} />);
			fireEvent.click(screen.getByRole("alert"));
			expect(onToastClick).toHaveBeenCalledWith(toast);
		});

		it("does not throw when onToastClick is not provided", () => {
			render(<ToastItem toast={makeToast()} onClose={vi.fn()} />);
			expect(() => fireEvent.click(screen.getByRole("alert"))).not.toThrow();
		});
	});

	// ---------------------------------------------------------------------------
	// Action button
	// ---------------------------------------------------------------------------

	describe("action button", () => {
		it("renders action button when primaryAction is present", () => {
			render(
				<ToastItem
					toast={makeToast({
						primaryAction: { label: "View Order", url: "https://example.com/order" },
					})}
					onClose={vi.fn()}
				/>,
			);
			expect(screen.getByText("View Order")).toBeDefined();
		});

		it("does not render action button when primaryAction is absent", () => {
			render(<ToastItem toast={makeToast()} onClose={vi.fn()} />);
			const buttons = screen.getByRole("alert").querySelectorAll("button");
			// Only the close button should exist
			expect(buttons.length).toBe(1);
			expect(buttons[0]!.getAttribute("aria-label")).toBe("Dismiss");
		});

		it("opens URL in new tab when action button is clicked", () => {
			const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
			render(
				<ToastItem
					toast={makeToast({
						primaryAction: { label: "View", url: "https://example.com" },
					})}
					onClose={vi.fn()}
				/>,
			);
			fireEvent.click(screen.getByText("View"));
			expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");
			openSpy.mockRestore();
		});

		it("does not call window.open when action has no URL", () => {
			const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
			render(
				<ToastItem
					toast={makeToast({
						primaryAction: { label: "View" },
					})}
					onClose={vi.fn()}
				/>,
			);
			fireEvent.click(screen.getByText("View"));
			expect(openSpy).not.toHaveBeenCalled();
			openSpy.mockRestore();
		});

		it("calls stopPropagation to prevent body click", () => {
			const onToastClick = vi.fn();
			render(
				<ToastItem
					toast={makeToast({
						primaryAction: { label: "View", url: "https://example.com" },
					})}
					onClose={vi.fn()}
					onToastClick={onToastClick}
				/>,
			);
			fireEvent.click(screen.getByText("View"));
			expect(onToastClick).not.toHaveBeenCalled();
		});
	});

	// ---------------------------------------------------------------------------
	// classNames overrides
	// ---------------------------------------------------------------------------

	describe("classNames overrides", () => {
		it("applies classNames.item to the root element", () => {
			render(<ToastItem toast={makeToast()} onClose={vi.fn()} classNames={{ item: "my-item" }} />);
			expect(screen.getByRole("alert").className).toContain("my-item");
		});

		it("applies classNames.closeButton to the close button", () => {
			render(
				<ToastItem
					toast={makeToast()}
					onClose={vi.fn()}
					classNames={{ closeButton: "my-close" }}
				/>,
			);
			expect(screen.getByLabelText("Dismiss").className).toContain("my-close");
		});

		it("applies classNames.content to the content area", () => {
			render(
				<ToastItem toast={makeToast()} onClose={vi.fn()} classNames={{ content: "my-content" }} />,
			);
			const alert = screen.getByRole("alert");
			const contentDiv = alert.querySelector(".toast_content");
			expect(contentDiv!.className).toContain("my-content");
		});
	});
});
