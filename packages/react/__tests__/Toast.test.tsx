import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "../src/components/Toast.js";

// ---------------------------------------------------------------------------
// Mock CSS modules
// ---------------------------------------------------------------------------

vi.mock("../src/styles/toast.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => `toast_${String(prop)}` }),
}));

// ---------------------------------------------------------------------------
// Mock useToast
// ---------------------------------------------------------------------------

let mockToasts: Array<{
	id: string;
	body: string;
	subject?: string;
	avatar?: string;
	primaryAction?: { label: string; url?: string };
	createdAt: string;
}> = [];
const mockDismiss = vi.fn();
const mockAdd = vi.fn();
const mockClear = vi.fn();
let capturedOptions: { duration?: number; maxSize?: number } | undefined;

vi.mock("@emito/react-hooks", () => ({
	useToast: (options?: { duration?: number; maxSize?: number }) => {
		capturedOptions = options;
		return {
			toasts: mockToasts,
			dismiss: mockDismiss,
			add: mockAdd,
			clear: mockClear,
		};
	},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToast(id: string, overrides?: Record<string, unknown>) {
	return {
		id,
		body: `Body for ${id}`,
		subject: `Subject for ${id}`,
		avatar: undefined as string | undefined,
		primaryAction: undefined as { label: string; url?: string } | undefined,
		secondaryAction: undefined as { label: string; url?: string } | undefined,
		data: undefined as Record<string, unknown> | undefined,
		createdAt: "2026-04-16T12:00:00.000Z",
		...overrides,
	};
}

afterEach(() => {
	mockToasts = [];
	capturedOptions = undefined;
	mockDismiss.mockClear();
	mockAdd.mockClear();
	mockClear.mockClear();
	cleanup();
});

// ---------------------------------------------------------------------------
// Portal rendering
// ---------------------------------------------------------------------------

describe("Toast", () => {
	describe("portal rendering", () => {
		it("renders via createPortal to document.body", () => {
			mockToasts = [makeToast("t1")];
			render(<Toast />);
			// The toast container should be a direct child of document.body
			const container = document.body.querySelector("[data-emito-toast-position]");
			expect(container).not.toBeNull();
		});

		it("renders nothing visible when toast queue is empty", () => {
			mockToasts = [];
			render(<Toast />);
			const container = document.body.querySelector("[data-emito-toast-position]");
			expect(container).not.toBeNull();
			expect(container!.children.length).toBe(0);
		});
	});

	// ---------------------------------------------------------------------------
	// Position prop
	// ---------------------------------------------------------------------------

	describe("position", () => {
		it("defaults to top-right", () => {
			render(<Toast />);
			const container = document.body.querySelector("[data-emito-toast-position]");
			expect(container!.getAttribute("data-emito-toast-position")).toBe("top-right");
			expect(container!.className).toContain("toast_topRight");
		});

		it("applies top-left position class", () => {
			render(<Toast position="top-left" />);
			const container = document.body.querySelector("[data-emito-toast-position]");
			expect(container!.getAttribute("data-emito-toast-position")).toBe("top-left");
			expect(container!.className).toContain("toast_topLeft");
		});

		it("applies bottom-right position class", () => {
			render(<Toast position="bottom-right" />);
			const container = document.body.querySelector("[data-emito-toast-position]");
			expect(container!.getAttribute("data-emito-toast-position")).toBe("bottom-right");
			expect(container!.className).toContain("toast_bottomRight");
		});

		it("applies bottom-left position class", () => {
			render(<Toast position="bottom-left" />);
			const container = document.body.querySelector("[data-emito-toast-position]");
			expect(container!.getAttribute("data-emito-toast-position")).toBe("bottom-left");
			expect(container!.className).toContain("toast_bottomLeft");
		});
	});

	// ---------------------------------------------------------------------------
	// Stacking order
	// ---------------------------------------------------------------------------

	describe("stacking order", () => {
		it("reverses order for top-right (newest first)", () => {
			mockToasts = [makeToast("t1"), makeToast("t2"), makeToast("t3")];
			render(<Toast position="top-right" />);
			const alerts = screen.getAllByRole("alert");
			// t3 is newest → should be first in DOM for top-right
			expect(alerts[0]!.textContent).toContain("Subject for t3");
			expect(alerts[2]!.textContent).toContain("Subject for t1");
		});

		it("reverses order for top-left (newest first)", () => {
			mockToasts = [makeToast("t1"), makeToast("t2")];
			render(<Toast position="top-left" />);
			const alerts = screen.getAllByRole("alert");
			expect(alerts[0]!.textContent).toContain("Subject for t2");
			expect(alerts[1]!.textContent).toContain("Subject for t1");
		});

		it("preserves order for bottom-right (newest last)", () => {
			mockToasts = [makeToast("t1"), makeToast("t2"), makeToast("t3")];
			render(<Toast position="bottom-right" />);
			const alerts = screen.getAllByRole("alert");
			expect(alerts[0]!.textContent).toContain("Subject for t1");
			expect(alerts[2]!.textContent).toContain("Subject for t3");
		});

		it("preserves order for bottom-left (newest last)", () => {
			mockToasts = [makeToast("t1"), makeToast("t2")];
			render(<Toast position="bottom-left" />);
			const alerts = screen.getAllByRole("alert");
			expect(alerts[0]!.textContent).toContain("Subject for t1");
			expect(alerts[1]!.textContent).toContain("Subject for t2");
		});
	});

	// ---------------------------------------------------------------------------
	// useToast options passthrough
	// ---------------------------------------------------------------------------

	describe("useToast options passthrough", () => {
		it("passes duration to useToast", () => {
			render(<Toast duration={3000} />);
			expect(capturedOptions?.duration).toBe(3000);
		});

		it("maps maxToasts to useToast maxSize", () => {
			render(<Toast maxToasts={3} />);
			expect(capturedOptions?.maxSize).toBe(3);
		});

		it("passes undefined when no duration or maxToasts specified", () => {
			render(<Toast />);
			expect(capturedOptions?.duration).toBeUndefined();
			expect(capturedOptions?.maxSize).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------------------
	// Toast item interactions
	// ---------------------------------------------------------------------------

	describe("toast item interactions", () => {
		it("calls dismiss when close button is clicked", () => {
			mockToasts = [makeToast("t1")];
			render(<Toast />);
			fireEvent.click(screen.getByLabelText("Dismiss"));
			expect(mockDismiss).toHaveBeenCalledWith("t1");
		});

		it("fires onToastClick when toast body is clicked", () => {
			const toast = makeToast("t1");
			mockToasts = [toast];
			const onToastClick = vi.fn();
			render(<Toast onToastClick={onToastClick} />);
			fireEvent.click(screen.getByRole("alert"));
			expect(onToastClick).toHaveBeenCalledWith(toast);
		});
	});

	// ---------------------------------------------------------------------------
	// classNames overrides
	// ---------------------------------------------------------------------------

	describe("classNames overrides", () => {
		it("applies classNames.container to the portal container", () => {
			render(<Toast classNames={{ container: "my-container" }} />);
			const container = document.body.querySelector("[data-emito-toast-position]");
			expect(container!.className).toContain("my-container");
		});

		it("passes classNames.item to ToastItem", () => {
			mockToasts = [makeToast("t1")];
			render(<Toast classNames={{ item: "my-item" }} />);
			expect(screen.getByRole("alert").className).toContain("my-item");
		});

		it("passes classNames.closeButton to ToastItem", () => {
			mockToasts = [makeToast("t1")];
			render(<Toast classNames={{ closeButton: "my-close" }} />);
			expect(screen.getByLabelText("Dismiss").className).toContain("my-close");
		});
	});

	// ---------------------------------------------------------------------------
	// renderToast render prop
	// ---------------------------------------------------------------------------

	describe("renderToast", () => {
		it("replaces entire toast item when renderToast is provided", () => {
			mockToasts = [makeToast("t1")];
			render(<Toast renderToast={(toast) => <div data-testid="custom-toast">{toast.body}</div>} />);
			expect(screen.getByTestId("custom-toast")).toBeDefined();
			expect(screen.getByTestId("custom-toast").textContent).toBe("Body for t1");
			// Default ToastItem should not render
			expect(screen.queryByRole("alert")).toBeNull();
		});

		it("renders custom toast for each item in queue", () => {
			mockToasts = [makeToast("t1"), makeToast("t2")];
			render(
				<Toast
					renderToast={(toast) => <div data-testid={`custom-${toast.id}`}>{toast.subject}</div>}
				/>,
			);
			expect(screen.getByTestId("custom-t1")).toBeDefined();
			expect(screen.getByTestId("custom-t2")).toBeDefined();
		});
	});

	// ---------------------------------------------------------------------------
	// Multiple toasts
	// ---------------------------------------------------------------------------

	describe("multiple toasts", () => {
		it("renders all toasts from the queue", () => {
			mockToasts = [makeToast("t1"), makeToast("t2"), makeToast("t3")];
			render(<Toast position="bottom-right" />);
			const alerts = screen.getAllByRole("alert");
			expect(alerts.length).toBe(3);
		});
	});

	// ---------------------------------------------------------------------------
	// ref forwarding
	// ---------------------------------------------------------------------------

	describe("ref forwarding", () => {
		it("forwards ref to the container div", () => {
			const ref = React.createRef<HTMLDivElement>();
			render(<Toast ref={ref} />);
			expect(ref.current).not.toBeNull();
			expect(ref.current!.getAttribute("data-emito-toast-position")).toBe("top-right");
		});
	});
});
