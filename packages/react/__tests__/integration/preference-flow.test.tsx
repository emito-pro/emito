import type { PreferenceRecord } from "@emito/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPreferenceRecord,
	createWorkspaceDefault,
	resetBuilderCounters,
} from "../helpers/builders.js";

// ---------------------------------------------------------------------------
// Mock CSS modules
// ---------------------------------------------------------------------------

vi.mock("../../src/styles/preferences.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? prop : "") }),
}));

// ---------------------------------------------------------------------------
// Stateful preference mocks
// ---------------------------------------------------------------------------

let mockPreferences: PreferenceRecord[] = [];
let mockIsLoading = false;
const mockUpdatePreference = vi.fn<
	(arg: { topicKey: string; channel: string; enabled: boolean }) => Promise<void>
>();
const mockResetPreferences = vi.fn<() => Promise<void>>();

vi.mock("@emito/react-hooks", () => ({
	usePreferences: () => ({
		preferences: mockPreferences,
		isLoading: mockIsLoading,
		updatePreference: mockUpdatePreference,
		resetPreferences: mockResetPreferences,
	}),
	useEmitoClient: () => ({
		integrations: {
			list: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
			deactivate: vi.fn(),
		},
	}),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks
// ---------------------------------------------------------------------------

import type { TopicDefinition } from "../../src/components/PreferenceCenter.js";
import { PreferenceCenter } from "../../src/components/PreferenceCenter.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TOPICS: TopicDefinition[] = [
	{
		topicKey: "security-alert",
		label: "Security Alerts",
		category: "transactional",
		channels: ["email", "push"],
	},
	{
		topicKey: "feature-announcement",
		label: "Feature Announcements",
		category: "product",
		channels: ["email", "inApp"],
	},
	{
		topicKey: "promotions",
		label: "Promotions",
		category: "marketing",
		channels: ["email", "push"],
	},
];

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	resetBuilderCounters();
	mockPreferences = [];
	mockIsLoading = false;
	mockUpdatePreference.mockReset().mockResolvedValue(undefined);
	mockResetPreferences.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Preference flow integration", () => {
	describe("grid rendering and data loading", () => {
		it("should render category headers, topic rows, and channel columns", () => {
			mockPreferences = [
				createPreferenceRecord({
					topicKey: "feature-announcement",
					channel: "email",
					enabled: true,
				}),
			];

			render(<PreferenceCenter topics={TOPICS} />);

			// Category headers
			expect(screen.getByText("Security & Transactional")).toBeDefined();
			expect(screen.getByText("Product Updates")).toBeDefined();
			expect(screen.getByText("Marketing")).toBeDefined();

			// Topic labels
			expect(screen.getByText("Security Alerts")).toBeDefined();
			expect(screen.getByText("Feature Announcements")).toBeDefined();
			expect(screen.getByText("Promotions")).toBeDefined();

			// Channel column headers
			expect(screen.getByText("Email")).toBeDefined();
			expect(screen.getByText("Push")).toBeDefined();
			expect(screen.getByText("In-App")).toBeDefined();
		});
	});

	describe("toggle preference", () => {
		it("should call updatePreference with correct params when a toggle is clicked", () => {
			mockPreferences = [
				createPreferenceRecord({
					topicKey: "feature-announcement",
					channel: "email",
					enabled: false,
				}),
			];

			render(<PreferenceCenter topics={TOPICS} />);

			// Find the toggle for feature-announcement email
			const toggle = screen.getByRole("switch", {
				name: "Feature Announcements email",
			});
			expect(toggle.getAttribute("aria-checked")).toBe("false");

			fireEvent.click(toggle);

			expect(mockUpdatePreference).toHaveBeenCalledWith({
				topicKey: "feature-announcement",
				channel: "email",
				enabled: true,
			});
		});

		it("should toggle from enabled to disabled", () => {
			mockPreferences = [
				createPreferenceRecord({
					topicKey: "feature-announcement",
					channel: "email",
					enabled: true,
				}),
			];

			render(<PreferenceCenter topics={TOPICS} />);

			const toggle = screen.getByRole("switch", {
				name: "Feature Announcements email",
			});
			expect(toggle.getAttribute("aria-checked")).toBe("true");

			fireEvent.click(toggle);

			expect(mockUpdatePreference).toHaveBeenCalledWith({
				topicKey: "feature-announcement",
				channel: "email",
				enabled: false,
			});
		});
	});

	describe("workspace mode with mandatory locks", () => {
		it("should render lock icons for mandatory workspace defaults", () => {
			mockPreferences = [
				createPreferenceRecord({
					topicKey: "promotions",
					channel: "email",
					enabled: false,
				}),
				createPreferenceRecord({
					topicKey: "promotions",
					channel: "push",
					enabled: true,
				}),
			];

			const workspaceDefaults = [
				createWorkspaceDefault({
					topicKey: "promotions",
					channel: "email",
					isMandatory: true,
				}),
				createWorkspaceDefault({
					topicKey: "promotions",
					channel: "push",
					isMandatory: true,
				}),
			];

			render(
				<PreferenceCenter
					topics={TOPICS}
					workspaceId="ws_1"
					workspaceDefaults={workspaceDefaults}
				/>,
			);

			// Workspace title
			expect(screen.getByText("Notification Preferences — Workspace")).toBeDefined();

			// Mandatory lock icons should render
			const lockIcons = screen.getAllByTitle("Required by your workspace admin");
			expect(lockIcons.length).toBe(2);
		});

		it("should not render lock icons when workspace defaults are not mandatory", () => {
			mockPreferences = [];

			const workspaceDefaults = [
				createWorkspaceDefault({
					topicKey: "promotions",
					channel: "email",
					isMandatory: false,
				}),
			];

			render(
				<PreferenceCenter
					topics={TOPICS}
					workspaceId="ws_1"
					workspaceDefaults={workspaceDefaults}
				/>,
			);

			expect(screen.queryByTitle("Required by your workspace admin")).toBeNull();
		});
	});

	describe("transactional topics", () => {
		it("should show always-sent lock icons for transactional topics", () => {
			mockPreferences = [];

			render(<PreferenceCenter topics={TOPICS} />);

			// Transactional topics show "Always sent" lock icons
			const alwaysSentIcons = screen.getAllByTitle("Always sent");
			// security-alert has 2 channels (email, push) → 2 lock icons
			expect(alwaysSentIcons.length).toBe(2);
		});

		it("should not render toggles for transactional topics", () => {
			mockPreferences = [];

			render(<PreferenceCenter topics={TOPICS} />);

			const switches = screen.getAllByRole("switch");
			// Product: feature-announcement (2 channels) = 2
			// Marketing: promotions (2 channels) = 2
			// Total: 4 toggles (transactional excluded)
			expect(switches.length).toBe(4);
		});
	});

	describe("non-applicable channels", () => {
		it("should render -- for channels not applicable to a topic", () => {
			mockPreferences = [];

			render(<PreferenceCenter topics={TOPICS} />);

			const dashes = screen.getAllByText("--");
			// security-alert: missing inApp → 1
			// feature-announcement: missing push → 1
			// promotions: missing inApp → 1
			// Total: 3
			expect(dashes.length).toBe(3);
		});
	});
});
