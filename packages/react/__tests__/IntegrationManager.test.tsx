import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationManager } from "../src/components/IntegrationManager.js";

afterEach(() => {
	cleanup();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const INTEGRATIONS = [
	{
		id: "int_1",
		subscriberId: "sub_1",
		channel: "slack" as const,
		name: "#alerts",
		events: ["security.*"],
		config: {},
		active: true,
		createdAt: "2026-01-01T00:00:00Z",
	},
	{
		id: "int_2",
		subscriberId: "sub_1",
		channel: "telegram" as const,
		name: "My Phone",
		events: [] as string[],
		config: {},
		active: true,
		createdAt: "2026-01-02T00:00:00Z",
	},
];

// ---------------------------------------------------------------------------
// Integration list rendering
// ---------------------------------------------------------------------------

describe("IntegrationManager", () => {
	describe("integration list", () => {
		it("renders integration items", () => {
			render(<IntegrationManager integrations={INTEGRATIONS} />);

			expect(screen.getByText("#alerts")).toBeDefined();
			expect(screen.getByText("My Phone")).toBeDefined();
		});

		it("renders channel labels for each integration", () => {
			render(<IntegrationManager integrations={INTEGRATIONS} />);

			expect(screen.getByText("slack")).toBeDefined();
			expect(screen.getByText("telegram")).toBeDefined();
		});

		it("shows loading state when isLoading is true", () => {
			render(<IntegrationManager integrations={[]} isLoading />);

			expect(screen.getByText("Loading integrations...")).toBeDefined();
		});

		it("renders empty state when no integrations exist", () => {
			render(<IntegrationManager integrations={[]} />);

			expect(screen.getByText("No integrations connected.")).toBeDefined();
		});

		it("does not show empty state while loading", () => {
			render(<IntegrationManager integrations={[]} isLoading />);

			expect(screen.queryByText("No integrations connected.")).toBeNull();
		});
	});

	// ---------------------------------------------------------------------------
	// Remove action
	// ---------------------------------------------------------------------------

	describe("remove action", () => {
		it("renders remove buttons when onRemove is provided", () => {
			render(<IntegrationManager integrations={INTEGRATIONS} onRemove={vi.fn()} />);

			expect(screen.getByRole("button", { name: "Remove #alerts" })).toBeDefined();
			expect(screen.getByRole("button", { name: "Remove My Phone" })).toBeDefined();
		});

		it("does not render remove buttons when onRemove is not provided", () => {
			render(<IntegrationManager integrations={INTEGRATIONS} />);

			expect(screen.queryByRole("button", { name: "Remove #alerts" })).toBeNull();
		});

		it("calls onRemove with integration id when clicked", () => {
			const handleRemove = vi.fn();
			render(<IntegrationManager integrations={INTEGRATIONS} onRemove={handleRemove} />);

			screen.getByRole("button", { name: "Remove #alerts" }).click();

			expect(handleRemove).toHaveBeenCalledWith("int_1");
		});
	});

	// ---------------------------------------------------------------------------
	// Add integration callback
	// ---------------------------------------------------------------------------

	describe("add integration", () => {
		it("renders add button when onAdd is provided", () => {
			render(<IntegrationManager integrations={[]} onAdd={() => {}} />);

			expect(screen.getByText("Add integration")).toBeDefined();
		});

		it("does not render add button when onAdd is not provided", () => {
			render(<IntegrationManager integrations={[]} />);

			expect(screen.queryByText("Add integration")).toBeNull();
		});

		it("calls onAdd when add button is clicked", () => {
			const handleAdd = vi.fn();
			render(<IntegrationManager integrations={[]} onAdd={handleAdd} />);

			screen.getByText("Add integration").click();
			expect(handleAdd).toHaveBeenCalledTimes(1);
		});
	});

	// ---------------------------------------------------------------------------
	// classNames overrides
	// ---------------------------------------------------------------------------

	describe("classNames", () => {
		it("applies classNames.integrations to the container", () => {
			render(
				<IntegrationManager integrations={[]} classNames={{ integrations: "my-integrations" }} />,
			);

			const heading = screen.getByText("Integrations");
			const container = heading.closest("div")?.parentElement;
			expect(container?.className).toContain("my-integrations");
		});
	});
});
