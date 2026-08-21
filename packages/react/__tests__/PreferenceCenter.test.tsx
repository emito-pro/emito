import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferenceCenter } from "../src/components/PreferenceCenter.js";
import type { RenderRowFn, TopicDefinition } from "../src/components/PreferenceCenter.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdatePreference = vi.fn();
const mockResetPreferences = vi.fn();
let mockPreferences: Array<{
	subscriberId: string;
	topicKey: string;
	channel: string;
	enabled: boolean;
}> = [];

vi.mock("@emito/react-hooks", () => ({
	usePreferences: () => ({
		preferences: mockPreferences,
		isLoading: false,
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

afterEach(() => {
	mockPreferences = [];
	mockUpdatePreference.mockClear();
	mockResetPreferences.mockClear();
	cleanup();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TOPICS: TopicDefinition[] = [
	{
		topicKey: "security-alert",
		label: "Security Alerts",
		category: "transactional",
		channels: ["email", "sms", "push"],
	},
	{
		topicKey: "feature-announcement",
		label: "Feature Announcements",
		category: "product",
		channels: ["email", "inApp"],
	},
	{
		topicKey: "onboarding-tips",
		label: "Onboarding Tips",
		category: "product",
		channels: ["email", "inApp", "push"],
	},
	{
		topicKey: "newsletter",
		label: "Newsletter",
		category: "marketing",
		channels: ["email"],
	},
	{
		topicKey: "promotions",
		label: "Promotions",
		category: "marketing",
		channels: ["email", "push"],
	},
];

// ---------------------------------------------------------------------------
// Grid rendering
// ---------------------------------------------------------------------------

describe("PreferenceCenter", () => {
	describe("grid rendering", () => {
		it("renders the title", () => {
			render(<PreferenceCenter topics={TOPICS} />);
			expect(screen.getByText("Notification Preferences")).toBeDefined();
		});

		it("renders workspace-scoped title when workspaceId is set", () => {
			render(<PreferenceCenter topics={TOPICS} workspaceId="ws_123" />);
			expect(screen.getByText("Notification Preferences — Workspace")).toBeDefined();
		});

		it("renders channel column headers dynamically", () => {
			render(<PreferenceCenter topics={TOPICS} />);
			expect(screen.getByText("Email")).toBeDefined();
			expect(screen.getByText("SMS")).toBeDefined();
			expect(screen.getByText("Push")).toBeDefined();
			expect(screen.getByText("In-App")).toBeDefined();
		});
	});

	// ---------------------------------------------------------------------------
	// Category grouping
	// ---------------------------------------------------------------------------

	describe("category grouping", () => {
		it("renders category headers", () => {
			render(<PreferenceCenter topics={TOPICS} />);
			expect(screen.getByText("Security & Transactional")).toBeDefined();
			expect(screen.getByText("Product Updates")).toBeDefined();
			expect(screen.getByText("Marketing")).toBeDefined();
		});

		it("renders topic labels under correct categories", () => {
			render(<PreferenceCenter topics={TOPICS} />);
			expect(screen.getByText("Security Alerts")).toBeDefined();
			expect(screen.getByText("Feature Announcements")).toBeDefined();
			expect(screen.getByText("Onboarding Tips")).toBeDefined();
			expect(screen.getByText("Newsletter")).toBeDefined();
			expect(screen.getByText("Promotions")).toBeDefined();
		});

		it("omits empty categories", () => {
			const productOnly: TopicDefinition[] = [
				{
					topicKey: "tips",
					label: "Tips",
					category: "product",
					channels: ["email"],
				},
			];
			render(<PreferenceCenter topics={productOnly} />);
			expect(screen.getByText("Product Updates")).toBeDefined();
			expect(screen.queryByText("Security & Transactional")).toBeNull();
			expect(screen.queryByText("Marketing")).toBeNull();
		});
	});

	// ---------------------------------------------------------------------------
	// Transactional always-enabled
	// ---------------------------------------------------------------------------

	describe("transactional topics", () => {
		it("renders lock icons for transactional topics (always sent)", () => {
			render(<PreferenceCenter topics={TOPICS} />);
			const alwaysSentElements = screen.getAllByTitle("Always sent");
			// security-alert has 3 applicable channels → 3 lock icons
			expect(alwaysSentElements.length).toBe(3);
		});

		it("does not render toggles for transactional topics", () => {
			render(<PreferenceCenter topics={TOPICS} />);
			// Transactional row should have no switches
			const switches = screen.getAllByRole("switch");
			// Product: feature-announcement (2 channels) + onboarding-tips (3) = 5
			// Marketing: newsletter (1) + promotions (2) = 3
			// Total: 8 toggles
			expect(switches.length).toBe(8);
		});
	});

	// ---------------------------------------------------------------------------
	// Non-applicable channels
	// ---------------------------------------------------------------------------

	describe("non-applicable channels", () => {
		it("renders -- for channels not applicable to a topic", () => {
			render(<PreferenceCenter topics={TOPICS} />);
			const dashes = screen.getAllByText("--");
			// security-alert: inApp(--) = 1
			// feature-announcement: sms(--), push(--) = 2
			// onboarding-tips: sms(--) = 1
			// newsletter: sms(--), push(--), inApp(--) = 3
			// promotions: sms(--), inApp(--) = 2
			// Total: 9
			expect(dashes.length).toBe(9);
		});
	});

	// ---------------------------------------------------------------------------
	// Mandatory workspace locks
	// ---------------------------------------------------------------------------

	describe("workspace mandatory locks", () => {
		it("renders lock icon for mandatory admin restrictions", () => {
			const workspaceDefaults = [
				{
					workspaceId: "ws_123",
					topicKey: "promotions",
					channel: "email" as const,
					enabled: false,
					isMandatory: true,
				},
				{
					workspaceId: "ws_123",
					topicKey: "promotions",
					channel: "push" as const,
					enabled: false,
					isMandatory: true,
				},
			];

			render(
				<PreferenceCenter
					topics={TOPICS}
					workspaceId="ws_123"
					workspaceDefaults={workspaceDefaults}
				/>,
			);

			const mandatoryElements = screen.getAllByTitle("Required by your workspace admin");
			expect(mandatoryElements.length).toBe(2);
		});

		it("does not lock non-mandatory workspace defaults", () => {
			const workspaceDefaults = [
				{
					workspaceId: "ws_123",
					topicKey: "promotions",
					channel: "email" as const,
					enabled: false,
					isMandatory: false,
				},
			];

			render(
				<PreferenceCenter
					topics={TOPICS}
					workspaceId="ws_123"
					workspaceDefaults={workspaceDefaults}
				/>,
			);

			expect(screen.queryByTitle("Required by your workspace admin")).toBeNull();
		});
	});

	// ---------------------------------------------------------------------------
	// Toggle interactions
	// ---------------------------------------------------------------------------

	describe("toggle interactions", () => {
		it("calls updatePreference on toggle click", async () => {
			render(<PreferenceCenter topics={TOPICS} />);
			const switches = screen.getAllByRole("switch");
			// Click the first non-transactional toggle
			switches[0]!.click();

			expect(mockUpdatePreference).toHaveBeenCalledTimes(1);
			const args = mockUpdatePreference.mock.calls[0]![0];
			expect(args).toHaveProperty("topicKey");
			expect(args).toHaveProperty("channel");
			expect(args).toHaveProperty("enabled", true);
		});

		it("passes correct enabled state based on current preference", () => {
			mockPreferences = [
				{
					subscriberId: "sub_1",
					topicKey: "feature-announcement",
					channel: "email",
					enabled: true,
				},
			];

			render(<PreferenceCenter topics={TOPICS} />);
			// Find the toggle that's currently checked
			const checkedSwitch = screen.getByRole("switch", {
				name: "Feature Announcements email",
			});
			expect(checkedSwitch.getAttribute("aria-checked")).toBe("true");

			// Click to disable
			checkedSwitch.click();
			expect(mockUpdatePreference).toHaveBeenCalledWith({
				topicKey: "feature-announcement",
				channel: "email",
				enabled: false,
			});
		});
	});

	// ---------------------------------------------------------------------------
	// Unsubscribe all
	// ---------------------------------------------------------------------------

	describe("unsubscribe all", () => {
		it("renders unsubscribe button when onUnsubscribeAll is provided", () => {
			render(<PreferenceCenter topics={TOPICS} onUnsubscribeAll={() => {}} />);
			expect(screen.getByText("Unsubscribe from all non-essential emails")).toBeDefined();
		});

		it("does not render unsubscribe button when onUnsubscribeAll is not provided", () => {
			render(<PreferenceCenter topics={TOPICS} />);
			expect(screen.queryByText("Unsubscribe from all non-essential emails")).toBeNull();
		});

		it("calls onUnsubscribeAll when clicked", () => {
			const handleUnsubscribe = vi.fn();
			render(<PreferenceCenter topics={TOPICS} onUnsubscribeAll={handleUnsubscribe} />);
			screen.getByText("Unsubscribe from all non-essential emails").click();
			expect(handleUnsubscribe).toHaveBeenCalledTimes(1);
		});
	});

	// ---------------------------------------------------------------------------
	// showIntegrations
	// ---------------------------------------------------------------------------

	describe("showIntegrations", () => {
		it("does not render IntegrationManager by default", () => {
			render(<PreferenceCenter topics={TOPICS} />);
			expect(screen.queryByText("Integrations")).toBeNull();
		});

		it("renders IntegrationManager when showIntegrations is true", () => {
			render(<PreferenceCenter topics={TOPICS} showIntegrations />);
			expect(screen.getByText("Integrations")).toBeDefined();
		});
	});

	// ---------------------------------------------------------------------------
	// classNames overrides
	// ---------------------------------------------------------------------------

	describe("classNames overrides", () => {
		it("applies classNames.grid to the table", () => {
			render(<PreferenceCenter topics={TOPICS} classNames={{ grid: "my-grid" }} />);
			const table = document.querySelector("table");
			expect(table?.className).toContain("my-grid");
		});

		it("applies classNames.categoryHeader to category header cells", () => {
			render(<PreferenceCenter topics={TOPICS} classNames={{ categoryHeader: "my-cat" }} />);
			const header = screen.getByText("Product Updates").closest("td");
			expect(header?.className).toContain("my-cat");
		});
	});

	// ---------------------------------------------------------------------------
	// renderRow render prop
	// ---------------------------------------------------------------------------

	describe("renderRow", () => {
		it("replaces default row rendering", () => {
			render(
				<PreferenceCenter
					topics={TOPICS}
					renderRow={(topic) => <div data-testid={`custom-${topic.topicKey}`}>{topic.label}</div>}
				/>,
			);

			expect(screen.getByTestId("custom-feature-announcement")).toBeDefined();
			expect(screen.getByTestId("custom-newsletter")).toBeDefined();
			// Default toggle switches should not render
			expect(screen.queryAllByRole("switch").length).toBe(0);
		});

		it("provides correct parameters to renderRow", () => {
			mockPreferences = [
				{
					subscriberId: "sub_1",
					topicKey: "newsletter",
					channel: "email",
					enabled: true,
				},
			];

			const renderRowSpy = vi.fn<RenderRowFn>((topic) => (
				<div data-testid={`row-${topic.topicKey}`}>{topic.label}</div>
			));

			render(<PreferenceCenter topics={TOPICS} renderRow={renderRowSpy} />);

			// Find the call for newsletter
			const newsletterCall = renderRowSpy.mock.calls.find(
				(call) => call[0].topicKey === "newsletter",
			);
			expect(newsletterCall).toBeDefined();
			// preferences Map should contain the email preference
			const prefsMap = newsletterCall![1];
			expect(prefsMap.get("email")).toBe(true);
			// lockedChannels should be empty
			const locked = newsletterCall![2];
			expect(locked.size).toBe(0);
			// alwaysEnabled should be false (marketing category)
			expect(newsletterCall![3]).toBe(false);
		});
	});
});
