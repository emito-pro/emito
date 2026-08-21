import type { Channel } from "@emito/types";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TopicDefinition } from "../src/components/PreferenceCenter.js";
import { PreferenceRow } from "../src/components/PreferenceRow.js";

// ---------------------------------------------------------------------------
// Mock usePreferences (required by PreferenceToggle's CSS module import chain)
// ---------------------------------------------------------------------------

vi.mock("@emito/react-hooks", () => ({
	usePreferences: () => ({
		preferences: [],
		isLoading: false,
		updatePreference: vi.fn(),
		resetPreferences: vi.fn(),
	}),
}));

afterEach(() => {
	cleanup();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const columns: Channel[] = ["email", "push", "sms", "inApp"];

const productTopic: TopicDefinition = {
	topicKey: "feature-announcement",
	label: "Feature Announcements",
	category: "product",
	channels: ["email", "inApp"],
};

const transactionalTopic: TopicDefinition = {
	topicKey: "security-alert",
	label: "Security Alerts",
	category: "transactional",
	channels: ["email", "sms", "push"],
};

function renderInTable(ui: React.ReactElement) {
	return render(
		<table>
			<tbody>{ui}</tbody>
		</table>,
	);
}

// ---------------------------------------------------------------------------
// Toggle interactions
// ---------------------------------------------------------------------------

describe("PreferenceRow", () => {
	describe("toggle interactions", () => {
		it("renders toggle switches for applicable channels", () => {
			renderInTable(
				<PreferenceRow
					topic={productTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={false}
					onToggle={vi.fn()}
				/>,
			);

			const switches = screen.getAllByRole("switch");
			// email + inApp = 2 applicable channels
			expect(switches.length).toBe(2);
		});

		it("calls onToggle with correct arguments when toggle is clicked", () => {
			const handleToggle = vi.fn();
			renderInTable(
				<PreferenceRow
					topic={productTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={false}
					onToggle={handleToggle}
				/>,
			);

			const switches = screen.getAllByRole("switch");
			switches[0]!.click();

			expect(handleToggle).toHaveBeenCalledTimes(1);
			expect(handleToggle).toHaveBeenCalledWith("feature-announcement", "email", true);
		});

		it("reflects current preference state in toggle", () => {
			const prefs = new Map<Channel, boolean>([
				["email", true],
				["inApp", false],
			]);

			renderInTable(
				<PreferenceRow
					topic={productTopic}
					columns={columns}
					preferences={prefs}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={false}
					onToggle={vi.fn()}
				/>,
			);

			const emailToggle = screen.getByRole("switch", {
				name: "Feature Announcements email",
			});
			const inAppToggle = screen.getByRole("switch", {
				name: "Feature Announcements inApp",
			});

			expect(emailToggle.getAttribute("aria-checked")).toBe("true");
			expect(inAppToggle.getAttribute("aria-checked")).toBe("false");
		});

		it("toggles off when preference is currently enabled", () => {
			const handleToggle = vi.fn();
			const prefs = new Map<Channel, boolean>([["email", true]]);

			renderInTable(
				<PreferenceRow
					topic={productTopic}
					columns={columns}
					preferences={prefs}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={false}
					onToggle={handleToggle}
				/>,
			);

			screen.getByRole("switch", { name: "Feature Announcements email" }).click();
			expect(handleToggle).toHaveBeenCalledWith("feature-announcement", "email", false);
		});
	});

	// ---------------------------------------------------------------------------
	// Non-applicable channels
	// ---------------------------------------------------------------------------

	describe("non-applicable channels", () => {
		it("renders -- for channels not in the topic's channels list", () => {
			renderInTable(
				<PreferenceRow
					topic={productTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={false}
					onToggle={vi.fn()}
				/>,
			);

			const dashes = screen.getAllByText("--");
			// push and sms are not in productTopic.channels
			expect(dashes.length).toBe(2);
		});
	});

	// ---------------------------------------------------------------------------
	// Always-enabled (transactional)
	// ---------------------------------------------------------------------------

	describe("always-enabled display", () => {
		it("renders lock icons with 'Always sent' for transactional topics", () => {
			renderInTable(
				<PreferenceRow
					topic={transactionalTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={true}
					onToggle={vi.fn()}
				/>,
			);

			const lockElements = screen.getAllByTitle("Always sent");
			// email, sms, push are applicable = 3 lock icons
			expect(lockElements.length).toBe(3);
			// No toggles should render
			expect(screen.queryAllByRole("switch").length).toBe(0);
		});

		it("still renders -- for non-applicable channels on transactional topics", () => {
			renderInTable(
				<PreferenceRow
					topic={transactionalTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={true}
					onToggle={vi.fn()}
				/>,
			);

			// inApp is not in transactionalTopic.channels
			const dashes = screen.getAllByText("--");
			expect(dashes.length).toBe(1);
		});
	});

	// ---------------------------------------------------------------------------
	// Mandatory lock display
	// ---------------------------------------------------------------------------

	describe("mandatory lock display", () => {
		it("renders lock icon for admin-locked channels", () => {
			const locked = new Set<Channel>(["email", "push"]);

			renderInTable(
				<PreferenceRow
					topic={productTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={locked}
					alwaysEnabled={false}
					onToggle={vi.fn()}
				/>,
			);

			const mandatoryElements = screen.getAllByTitle("Required by your workspace admin");
			// Only email is both applicable AND locked (push not in productTopic.channels)
			expect(mandatoryElements.length).toBe(1);
		});

		it("does not render toggles for locked channels", () => {
			const locked = new Set<Channel>(["email", "inApp"]);

			renderInTable(
				<PreferenceRow
					topic={productTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={locked}
					alwaysEnabled={false}
					onToggle={vi.fn()}
				/>,
			);

			// Both applicable channels are locked → no switches
			expect(screen.queryAllByRole("switch").length).toBe(0);
		});
	});

	// ---------------------------------------------------------------------------
	// classNames overrides
	// ---------------------------------------------------------------------------

	describe("classNames overrides", () => {
		it("applies classNames.row to the row element", () => {
			renderInTable(
				<PreferenceRow
					topic={productTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={false}
					classNames={{ row: "my-row" }}
					onToggle={vi.fn()}
				/>,
			);

			const row = screen.getByText("Feature Announcements").closest("tr");
			expect(row?.className).toContain("my-row");
		});

		it("applies classNames.toggle to toggle switches", () => {
			renderInTable(
				<PreferenceRow
					topic={productTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={false}
					classNames={{ toggle: "my-toggle" }}
					onToggle={vi.fn()}
				/>,
			);

			const switches = screen.getAllByRole("switch");
			expect(switches[0]!.className).toContain("my-toggle");
		});

		it("applies classNames.lockIcon to lock icons", () => {
			renderInTable(
				<PreferenceRow
					topic={transactionalTopic}
					columns={columns}
					preferences={new Map<Channel, boolean>()}
					lockedChannels={new Set<Channel>()}
					alwaysEnabled={true}
					classNames={{ lockIcon: "my-lock" }}
					onToggle={vi.fn()}
				/>,
			);

			const lockElement = screen.getAllByTitle("Always sent")[0]!;
			expect(lockElement.className).toContain("my-lock");
		});
	});
});
