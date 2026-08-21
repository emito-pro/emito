/**
 * Centralized default theme values for all templates.
 *
 * These are fallbacks when BrandTheme fields are not provided.
 * All template components and utilities reference these constants
 * instead of hardcoding color/typography values.
 */

export const THEME_DEFAULTS = {
	primaryColor: "#6366f1",
	dangerColor: "#dc2626",
	backgroundColor: "#f9fafb",
	textColor: "#111827",
	mutedColor: "#6b7280",
	separatorColor: "#e5e7eb",
	buttonTextColor: "#ffffff",
	fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
	surfaceColor: "#f3f4f6",
	buttonRadius: "6px",
	buttonPadding: "12px 24px",
} as const;
