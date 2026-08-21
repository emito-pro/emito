import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SnoozePicker } from "../src/components/SnoozePicker.js";

// Mock CSS modules
vi.mock("../src/styles/inbox.module.css", () => ({
	default: new Proxy(
		{},
		{
			get: (_target, prop) => (typeof prop === "string" ? prop : ""),
		},
	),
}));

// Mock useEmitoClient. `snooze` returns a Promise in the real client; the
// component chains `.then()` on it, so the mock must resolve a thenable. The
// component also calls `client.emit("snoozed", ...)` inside that `.then`, so
// the mock client must expose an `emit` function.
const mockSnooze = vi.fn().mockResolvedValue(undefined);
const mockEmit = vi.fn();
vi.mock("@emito/react-hooks", () => ({
	useEmitoClient: () => ({
		notifications: {
			snooze: mockSnooze,
		},
		emit: mockEmit,
	}),
}));

const NOW = new Date("2026-04-16T12:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	cleanup();
});

describe("SnoozePicker", () => {
	it("renders all five snooze options", () => {
		render(<SnoozePicker notificationId="ntf_1" />);

		expect(screen.getByText("15 minutes")).toBeDefined();
		expect(screen.getByText("1 hour")).toBeDefined();
		expect(screen.getByText("4 hours")).toBeDefined();
		expect(screen.getByText("Tomorrow")).toBeDefined();
		expect(screen.getByText("Next week")).toBeDefined();
	});

	it("renders the 'Snooze until' label", () => {
		render(<SnoozePicker notificationId="ntf_1" />);
		expect(screen.getByText("Snooze until")).toBeDefined();
	});

	it("calls client.notifications.snooze with notificationId and ~1h from now when '1 hour' clicked", () => {
		render(<SnoozePicker notificationId="ntf_42" />);
		fireEvent.click(screen.getByText("1 hour"));

		expect(mockSnooze).toHaveBeenCalledTimes(1);
		const [id, until] = mockSnooze.mock.calls[0]!;
		expect(id).toBe("ntf_42");
		const expectedMs = NOW + 3_600_000;
		expect(Math.abs(until.getTime() - expectedMs)).toBeLessThan(5000);
	});

	it("calls client.notifications.snooze with ~4h from now when '4 hours' clicked", () => {
		render(<SnoozePicker notificationId="ntf_42" />);
		fireEvent.click(screen.getByText("4 hours"));

		expect(mockSnooze).toHaveBeenCalledTimes(1);
		const [id, until] = mockSnooze.mock.calls[0]!;
		expect(id).toBe("ntf_42");
		const expectedMs = NOW + 14_400_000;
		expect(Math.abs(until.getTime() - expectedMs)).toBeLessThan(5000);
	});

	it("calls client.notifications.snooze with tomorrow 9am when 'Tomorrow' clicked", () => {
		render(<SnoozePicker notificationId="ntf_42" />);
		fireEvent.click(screen.getByText("Tomorrow"));

		expect(mockSnooze).toHaveBeenCalledTimes(1);
		const [id, until] = mockSnooze.mock.calls[0]!;
		expect(id).toBe("ntf_42");
		// Should be 9am in local time
		expect(until.getHours()).toBe(9);
		expect(until.getMinutes()).toBe(0);
		// Should be at least 12 hours from now (i.e. actually "tomorrow", not today)
		expect(until.getTime()).toBeGreaterThan(NOW + 12 * 3_600_000);
	});

	it("calls client.notifications.snooze with next Monday 9am when 'Next week' clicked", () => {
		render(<SnoozePicker notificationId="ntf_42" />);
		fireEvent.click(screen.getByText("Next week"));

		expect(mockSnooze).toHaveBeenCalledTimes(1);
		const [id, until] = mockSnooze.mock.calls[0]!;
		expect(id).toBe("ntf_42");
		expect(until.getHours()).toBe(9);
		expect(until.getDay()).toBe(1); // Monday
	});

	it("calls onSelect callback after snooze option is selected", () => {
		const onSelect = vi.fn();
		render(<SnoozePicker notificationId="ntf_42" onSelect={onSelect} />);

		fireEvent.click(screen.getByText("1 hour"));

		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	it("applies classNames overrides", () => {
		const { container } = render(
			<SnoozePicker
				notificationId="ntf_1"
				classNames={{ root: "my-root", label: "my-label", option: "my-option" }}
			/>,
		);

		expect(container.querySelector(".my-root")).not.toBeNull();
		expect(container.querySelector(".my-label")).not.toBeNull();
		expect(container.querySelectorAll(".my-option").length).toBe(5);
	});
});
