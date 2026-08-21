import type { NotificationItem } from "@emito/js";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotificationItem, resetBuilderCounters } from "../helpers/builders.js";

// ---------------------------------------------------------------------------
// Mock CSS modules
// ---------------------------------------------------------------------------

vi.mock("../../src/styles/bell.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? prop : "") }),
}));

vi.mock("../../src/styles/inbox.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? prop : "") }),
}));

vi.mock("../../src/styles/preferences.module.css", () => ({
	default: new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? prop : "") }),
}));

// ---------------------------------------------------------------------------
// Stateful hook mocks
// ---------------------------------------------------------------------------

let mockNotifications: NotificationItem[] = [];
let mockUnreadCount = 0;

vi.mock("@emito/react-hooks", () => ({
	useNotifications: () => ({
		notifications: mockNotifications,
		isLoading: false,
		hasMore: false,
		fetchMore: vi.fn().mockResolvedValue(undefined),
		markAsRead: vi.fn().mockResolvedValue(undefined),
		markAsUnread: vi.fn(),
		markAllAsRead: vi.fn().mockResolvedValue(undefined),
		archive: vi.fn().mockResolvedValue(undefined),
	}),
	useUnreadCount: () => ({ unreadCount: mockUnreadCount }),
	usePreferences: () => ({
		preferences: [],
		isLoading: false,
		updatePreference: vi.fn(),
		resetPreferences: vi.fn(),
	}),
	useEmitoClient: () => ({
		notifications: { snooze: vi.fn() },
		integrations: {
			list: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
			deactivate: vi.fn(),
		},
	}),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks
// ---------------------------------------------------------------------------

import { NotificationBell } from "../../src/components/NotificationBell.js";
import { NotificationFeed } from "../../src/components/NotificationFeed.js";
import type { TopicDefinition } from "../../src/components/PreferenceCenter.js";
import { PreferenceCenter } from "../../src/components/PreferenceCenter.js";
import {
	EmitoThemeProvider,
	useThemeAppearance,
	useThemeClassNames,
} from "../../src/theme/EmitoThemeProvider.js";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const NOW = new Date("2026-04-16T12:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	resetBuilderCounters();
	mockNotifications = [];
	mockUnreadCount = 0;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	cleanup();
});

// ---------------------------------------------------------------------------
// Test consumer components for context verification
// ---------------------------------------------------------------------------

function AppearanceReader() {
	const appearance = useThemeAppearance();
	return <span data-testid="appearance-reader">{JSON.stringify(appearance)}</span>;
}

function ClassNamesReader() {
	const classNames = useThemeClassNames();
	return <span data-testid="cn-reader">{JSON.stringify(classNames)}</span>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Theme flow integration", () => {
	describe("CSS custom properties propagation", () => {
		it("should inject --emito-* CSS variables on the theme wrapper div", () => {
			mockNotifications = [createNotificationItem()];
			mockUnreadCount = 1;

			render(
				<EmitoThemeProvider
					appearance={{
						variables: {
							colorPrimary: "#6366f1",
							fontSize: "16px",
							borderRadius: "8px",
						},
					}}
				>
					<NotificationBell />
					<NotificationFeed />
				</EmitoThemeProvider>,
			);

			// Bell renders
			const bell = screen.getByRole("button", { name: "Notifications" });

			// Find the EmitoThemeProvider wrapper div (has inline style)
			const themeWrapper = bell.closest("div[style]");
			expect(themeWrapper).toBeInstanceOf(HTMLElement);
			if (!(themeWrapper instanceof HTMLElement)) throw new Error("unreachable");

			// Assert CSS custom properties on the wrapper div
			expect(themeWrapper.style.getPropertyValue("--emito-color-primary")).toBe("#6366f1");
			expect(themeWrapper.style.getPropertyValue("--emito-font-size")).toBe("16px");
			expect(themeWrapper.style.getPropertyValue("--emito-border-radius")).toBe("8px");
		});

		it("should render no inline styles when appearance has no variables", () => {
			mockUnreadCount = 0;

			render(
				<EmitoThemeProvider>
					<NotificationBell />
				</EmitoThemeProvider>,
			);

			const bell = screen.getByRole("button", { name: "Notifications" });
			const wrapper = bell.parentElement;
			expect(wrapper).not.toBeNull();
			expect(wrapper!.style.length).toBe(0);
		});

		it("should inject all 13 standard CSS variables when all are provided", () => {
			render(
				<EmitoThemeProvider
					appearance={{
						variables: {
							colorPrimary: "#6366f1",
							colorBackground: "#ffffff",
							colorForeground: "#111827",
							colorMuted: "#6b7280",
							colorBorder: "#e5e7eb",
							colorUnread: "#3b82f6",
							colorDanger: "#dc2626",
							colorSuccess: "#16a34a",
							fontFamily: "system-ui",
							fontSize: "14px",
							borderRadius: "8px",
							inboxWidth: "400px",
							inboxMaxHeight: "480px",
						},
					}}
				>
					<span data-testid="child">Content</span>
				</EmitoThemeProvider>,
			);

			const child = screen.getByTestId("child");
			const wrapper = child.parentElement!;

			expect(wrapper.style.getPropertyValue("--emito-color-primary")).toBe("#6366f1");
			expect(wrapper.style.getPropertyValue("--emito-color-background")).toBe("#ffffff");
			expect(wrapper.style.getPropertyValue("--emito-color-foreground")).toBe("#111827");
			expect(wrapper.style.getPropertyValue("--emito-color-muted")).toBe("#6b7280");
			expect(wrapper.style.getPropertyValue("--emito-color-border")).toBe("#e5e7eb");
			expect(wrapper.style.getPropertyValue("--emito-color-unread")).toBe("#3b82f6");
			expect(wrapper.style.getPropertyValue("--emito-color-danger")).toBe("#dc2626");
			expect(wrapper.style.getPropertyValue("--emito-color-success")).toBe("#16a34a");
			expect(wrapper.style.getPropertyValue("--emito-font-family")).toBe("system-ui");
			expect(wrapper.style.getPropertyValue("--emito-font-size")).toBe("14px");
			expect(wrapper.style.getPropertyValue("--emito-border-radius")).toBe("8px");
			expect(wrapper.style.getPropertyValue("--emito-inbox-width")).toBe("400px");
			expect(wrapper.style.getPropertyValue("--emito-inbox-max-height")).toBe("480px");
		});
	});

	describe("classNames context propagation", () => {
		it("should propagate classNames through the theme context to nested consumers", () => {
			render(
				<EmitoThemeProvider
					classNames={{
						item: "custom-item-class",
						badge: "custom-badge-class",
						feed: "custom-feed-class",
					}}
				>
					<ClassNamesReader />
				</EmitoThemeProvider>,
			);

			const reader = screen.getByTestId("cn-reader");
			const parsed = JSON.parse(reader.textContent!);
			expect(parsed.item).toBe("custom-item-class");
			expect(parsed.badge).toBe("custom-badge-class");
			expect(parsed.feed).toBe("custom-feed-class");
		});

		it("should return empty object when used outside EmitoThemeProvider", () => {
			render(<ClassNamesReader />);

			const reader = screen.getByTestId("cn-reader");
			const parsed = JSON.parse(reader.textContent!);
			expect(parsed).toEqual({});
		});
	});

	describe("appearance context propagation", () => {
		it("should make appearance available via useThemeAppearance to nested components", () => {
			render(
				<EmitoThemeProvider
					appearance={{
						variables: {
							colorPrimary: "#ff0000",
							colorBackground: "#ffffff",
						},
					}}
				>
					<AppearanceReader />
				</EmitoThemeProvider>,
			);

			const reader = screen.getByTestId("appearance-reader");
			const parsed = JSON.parse(reader.textContent!);
			expect(parsed.variables.colorPrimary).toBe("#ff0000");
			expect(parsed.variables.colorBackground).toBe("#ffffff");
		});

		it("should return empty object when used outside EmitoThemeProvider", () => {
			render(<AppearanceReader />);

			const reader = screen.getByTestId("appearance-reader");
			const parsed = JSON.parse(reader.textContent!);
			expect(parsed).toEqual({});
		});
	});

	describe("full tree with multiple components", () => {
		it("should apply theme to bell, feed, and preference center in the same tree", () => {
			const topics: TopicDefinition[] = [
				{
					topicKey: "tips",
					label: "Tips",
					category: "product",
					channels: ["email"],
				},
			];
			mockNotifications = [createNotificationItem({ subject: "Tree test notif" })];
			mockUnreadCount = 1;

			render(
				<EmitoThemeProvider appearance={{ variables: { colorPrimary: "#10b981" } }}>
					<NotificationBell />
					<NotificationFeed />
					<PreferenceCenter topics={topics} />
				</EmitoThemeProvider>,
			);

			// All components render within the themed tree
			expect(screen.getByRole("button", { name: "Notifications" })).toBeDefined();
			expect(screen.getByText("Tree test notif")).toBeDefined();
			expect(screen.getByText("Notification Preferences")).toBeDefined();
			expect(screen.getByText("Tips")).toBeDefined();

			// Theme wrapper wraps all of them
			const bell = screen.getByRole("button", { name: "Notifications" });
			const themeWrapper = bell.closest("div[style]");
			expect(themeWrapper).toBeInstanceOf(HTMLElement);
			if (!(themeWrapper instanceof HTMLElement)) throw new Error("unreachable");
			expect(themeWrapper.style.getPropertyValue("--emito-color-primary")).toBe("#10b981");

			// Feed and preference center are inside the same theme wrapper
			const feedNotif = screen.getByText("Tree test notif");
			expect(themeWrapper.contains(feedNotif)).toBe(true);

			const prefTitle = screen.getByText("Notification Preferences");
			expect(themeWrapper.contains(prefTitle)).toBe(true);
		});

		it("should propagate both appearance and classNames simultaneously", () => {
			render(
				<EmitoThemeProvider
					appearance={{ variables: { colorPrimary: "#6366f1" } }}
					classNames={{ item: "themed-item", badge: "themed-badge" }}
				>
					<AppearanceReader />
					<ClassNamesReader />
				</EmitoThemeProvider>,
			);

			// Appearance propagates
			const appearance = JSON.parse(screen.getByTestId("appearance-reader").textContent!);
			expect(appearance.variables.colorPrimary).toBe("#6366f1");

			// ClassNames propagate
			const cn = JSON.parse(screen.getByTestId("cn-reader").textContent!);
			expect(cn.item).toBe("themed-item");
			expect(cn.badge).toBe("themed-badge");

			// CSS vars on wrapper
			const reader = screen.getByTestId("appearance-reader");
			const wrapper = reader.closest("div[style]");
			expect(wrapper).toBeInstanceOf(HTMLElement);
			if (!(wrapper instanceof HTMLElement)) throw new Error("unreachable");
			expect(wrapper.style.getPropertyValue("--emito-color-primary")).toBe("#6366f1");
		});
	});
});
