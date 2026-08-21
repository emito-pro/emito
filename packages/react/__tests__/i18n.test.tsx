import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "../src/components/EmptyState.js";
import { EmitoMessagesProvider } from "../src/i18n/context.js";
import { defaultMessages, mergeMessages } from "../src/i18n/messages.js";
import { EmitoThemeProvider } from "../src/theme/EmitoThemeProvider.js";

afterEach(() => {
	cleanup();
});

describe("mergeMessages", () => {
	it("returns the English defaults when no override is given", () => {
		expect(mergeMessages()).toEqual(defaultMessages);
	});

	it("deep-merges a partial override, keeping untouched keys at their defaults", () => {
		const merged = mergeMessages({
			preferences: {
				title: "Preferencje powiadomień",
				categories: { product: "Aktualizacje" },
			},
		});

		expect(merged.preferences.title).toBe("Preferencje powiadomień");
		// sibling category not overridden → default
		expect(merged.preferences.categories.transactional).toBe("Security & Transactional");
		expect(merged.preferences.categories.product).toBe("Aktualizacje");
		// unrelated section untouched
		expect(merged.inbox.archive).toBe(defaultMessages.inbox.archive);
	});
});

describe("useMessages via EmitoMessagesProvider", () => {
	it("renders the English defaults with no provider", () => {
		render(<EmptyState />);
		expect(screen.getByText("No notifications yet")).toBeTruthy();
	});

	it("renders overridden copy from EmitoMessagesProvider", () => {
		render(
			<EmitoMessagesProvider messages={{ inbox: { emptyTitle: "Brak powiadomień" } }}>
				<EmptyState />
			</EmitoMessagesProvider>,
		);
		expect(screen.getByText("Brak powiadomień")).toBeTruthy();
	});

	it("propagates messages passed through EmitoThemeProvider", () => {
		render(
			<EmitoThemeProvider messages={{ inbox: { emptyTitle: "Brak powiadomień" } }}>
				<EmptyState />
			</EmitoThemeProvider>,
		);
		expect(screen.getByText("Brak powiadomień")).toBeTruthy();
	});

	it("still lets an explicit prop win over the catalog", () => {
		render(
			<EmitoMessagesProvider messages={{ inbox: { emptyTitle: "Brak powiadomień" } }}>
				<EmptyState title="Explicit" />
			</EmitoMessagesProvider>,
		);
		expect(screen.getByText("Explicit")).toBeTruthy();
	});
});
