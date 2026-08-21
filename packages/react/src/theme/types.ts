import type { ReactNode } from "react";
import type { PartialEmitoMessages } from "../i18n/messages.js";

/**
 * Themeable CSS variable keys — camelCase mirrors of `--emito-*` custom properties.
 */
export interface EmitoVariables {
	colorPrimary: string;
	colorBackground: string;
	colorForeground: string;
	colorMuted: string;
	colorBorder: string;
	colorUnread: string;
	colorDanger: string;
	colorSuccess: string;
	fontFamily: string;
	fontSize: string;
	borderRadius: string;
	inboxWidth: string;
	inboxMaxHeight: string;
}

/**
 * Appearance configuration passed to EmitoThemeProvider.
 * `variables` maps camelCase keys to CSS values — applied as `--emito-*` custom properties.
 */
export interface EmitoAppearance {
	variables?: Partial<EmitoVariables>;
}

/**
 * Per-slot CSS class overrides. Keys are component slot names (e.g. "item", "avatar"),
 * values are CSS class strings applied to the corresponding DOM element.
 */
export type EmitoClassNames = Record<string, string>;

export interface EmitoThemeProviderProps {
	appearance?: EmitoAppearance;
	classNames?: EmitoClassNames;
	/**
	 * Localized copy overrides for child components (deep-merged over the
	 * English defaults). Renders an `EmitoMessagesProvider` around `children`.
	 */
	messages?: PartialEmitoMessages;
	children?: ReactNode;
}
