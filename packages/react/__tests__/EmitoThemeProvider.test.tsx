import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	EmitoThemeProvider,
	useThemeAppearance,
	useThemeClassNames,
} from "../src/theme/EmitoThemeProvider.js";
import { appearanceToVars } from "../src/theme/css-vars.js";
import type { EmitoAppearance, EmitoClassNames } from "../src/theme/types.js";

afterEach(() => {
	cleanup();
});

// ---------------------------------------------------------------------------
// appearanceToVars — unit tests
// ---------------------------------------------------------------------------

describe("appearanceToVars", () => {
	it("returns empty object when no variables provided", () => {
		expect(appearanceToVars({})).toEqual({});
	});

	it("returns empty object when variables is undefined", () => {
		expect(appearanceToVars({ variables: undefined })).toEqual({});
	});

	it("converts a single camelCase variable to --emito-kebab-case", () => {
		const result = appearanceToVars({
			variables: { colorPrimary: "#6366f1" },
		});
		expect(result).toEqual({ "--emito-color-primary": "#6366f1" });
	});

	it("converts multiple variables", () => {
		const result = appearanceToVars({
			variables: {
				colorPrimary: "#6366f1",
				colorBackground: "#ffffff",
				fontSize: "16px",
			},
		});
		expect(result).toEqual({
			"--emito-color-primary": "#6366f1",
			"--emito-color-background": "#ffffff",
			"--emito-font-size": "16px",
		});
	});

	it("skips undefined values in partial variables", () => {
		const result = appearanceToVars({
			variables: { colorPrimary: "#6366f1", colorBackground: undefined },
		});
		expect(result).toEqual({ "--emito-color-primary": "#6366f1" });
	});

	it("handles variables with no uppercase letters", () => {
		// Edge case: a key that's already lowercase
		const result = appearanceToVars({
			variables: { fontSize: "14px" },
		});
		expect(result).toEqual({ "--emito-font-size": "14px" });
	});

	it("handles all 13 standard variables", () => {
		const result = appearanceToVars({
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
		});
		expect(Object.keys(result)).toHaveLength(13);
		expect(result["--emito-color-primary"]).toBe("#6366f1");
		expect(result["--emito-inbox-max-height"]).toBe("480px");
	});
});

// ---------------------------------------------------------------------------
// EmitoThemeProvider — component tests
// ---------------------------------------------------------------------------

describe("EmitoThemeProvider", () => {
	it("renders children", () => {
		render(
			<EmitoThemeProvider>
				<span data-testid="child">Hello</span>
			</EmitoThemeProvider>,
		);
		expect(screen.getByTestId("child").textContent).toBe("Hello");
	});

	it("injects --emito-* CSS custom properties on wrapper div", () => {
		render(
			<EmitoThemeProvider appearance={{ variables: { colorPrimary: "#6366f1" } }}>
				<span data-testid="child">Content</span>
			</EmitoThemeProvider>,
		);

		const wrapper = screen.getByTestId("child").parentElement;
		expect(wrapper).not.toBeNull();
		expect(wrapper!.tagName).toBe("DIV");
		expect(wrapper!.style.getPropertyValue("--emito-color-primary")).toBe("#6366f1");
	});

	it("injects multiple CSS custom properties", () => {
		render(
			<EmitoThemeProvider
				appearance={{
					variables: {
						colorPrimary: "#6366f1",
						colorBackground: "#ffffff",
						borderRadius: "12px",
					},
				}}
			>
				<span data-testid="child">Content</span>
			</EmitoThemeProvider>,
		);

		const wrapper = screen.getByTestId("child").parentElement!;
		expect(wrapper.style.getPropertyValue("--emito-color-primary")).toBe("#6366f1");
		expect(wrapper.style.getPropertyValue("--emito-color-background")).toBe("#ffffff");
		expect(wrapper.style.getPropertyValue("--emito-border-radius")).toBe("12px");
	});

	it("renders without appearance or classNames (defaults)", () => {
		render(
			<EmitoThemeProvider>
				<span data-testid="child">Content</span>
			</EmitoThemeProvider>,
		);

		const wrapper = screen.getByTestId("child").parentElement!;
		expect(wrapper.tagName).toBe("DIV");
		// No inline CSS vars when appearance is not provided
		expect(wrapper.style.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// useThemeAppearance — context hook
// ---------------------------------------------------------------------------

describe("useThemeAppearance", () => {
	function AppearanceConsumer() {
		const appearance = useThemeAppearance();
		return <span data-testid="appearance">{JSON.stringify(appearance)}</span>;
	}

	it("returns the appearance provided by EmitoThemeProvider", () => {
		const appearance: EmitoAppearance = {
			variables: { colorPrimary: "#ff0000" },
		};
		render(
			<EmitoThemeProvider appearance={appearance}>
				<AppearanceConsumer />
			</EmitoThemeProvider>,
		);
		const parsed = JSON.parse(screen.getByTestId("appearance").textContent!);
		expect(parsed.variables.colorPrimary).toBe("#ff0000");
	});

	it("returns empty object when used outside EmitoThemeProvider", () => {
		render(<AppearanceConsumer />);
		const parsed = JSON.parse(screen.getByTestId("appearance").textContent!);
		expect(parsed).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// useThemeClassNames — context hook
// ---------------------------------------------------------------------------

describe("useThemeClassNames", () => {
	function ClassNamesConsumer() {
		const classNames = useThemeClassNames();
		return <span data-testid="classnames">{JSON.stringify(classNames)}</span>;
	}

	it("returns classNames provided by EmitoThemeProvider", () => {
		const classNames: EmitoClassNames = {
			item: "my-item",
			avatar: "my-avatar",
		};
		render(
			<EmitoThemeProvider classNames={classNames}>
				<ClassNamesConsumer />
			</EmitoThemeProvider>,
		);
		const parsed = JSON.parse(screen.getByTestId("classnames").textContent!);
		expect(parsed).toEqual({ item: "my-item", avatar: "my-avatar" });
	});

	it("returns empty object when used outside EmitoThemeProvider", () => {
		render(<ClassNamesConsumer />);
		const parsed = JSON.parse(screen.getByTestId("classnames").textContent!);
		expect(parsed).toEqual({});
	});
});
