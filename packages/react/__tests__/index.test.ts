import { describe, expect, it } from "vitest";
import {
	EmitoProvider,
	EmitoThemeProvider,
	appearanceToVars,
	useClientEvent,
	useEmitoClient,
	useNotifications,
	usePreferences,
	useThemeAppearance,
	useThemeClassNames,
	useUnreadCount,
} from "../src/index.js";

describe("@emito/react barrel exports", () => {
	describe("re-exports from @emito/react-hooks", () => {
		it("exports EmitoProvider", () => {
			expect(typeof EmitoProvider).toBe("function");
		});

		it("exports useEmitoClient", () => {
			expect(typeof useEmitoClient).toBe("function");
		});

		it("exports useClientEvent", () => {
			expect(typeof useClientEvent).toBe("function");
		});

		it("exports useNotifications", () => {
			expect(typeof useNotifications).toBe("function");
		});

		it("exports useUnreadCount", () => {
			expect(typeof useUnreadCount).toBe("function");
		});

		it("exports usePreferences", () => {
			expect(typeof usePreferences).toBe("function");
		});
	});

	describe("theme exports", () => {
		it("exports EmitoThemeProvider", () => {
			expect(typeof EmitoThemeProvider).toBe("function");
		});

		it("exports useThemeAppearance", () => {
			expect(typeof useThemeAppearance).toBe("function");
		});

		it("exports useThemeClassNames", () => {
			expect(typeof useThemeClassNames).toBe("function");
		});

		it("exports appearanceToVars", () => {
			expect(typeof appearanceToVars).toBe("function");
		});
	});
});
