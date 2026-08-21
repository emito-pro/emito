import { type ReactNode, createContext, useContext } from "react";
import { EmitoMessagesProvider } from "../i18n/context.js";
import { appearanceToVars } from "./css-vars.js";
import type { EmitoAppearance, EmitoClassNames, EmitoThemeProviderProps } from "./types.js";

const ThemeAppearanceContext = createContext<EmitoAppearance>({});
const ThemeClassNamesContext = createContext<EmitoClassNames>({});

/**
 * Provides theming context for Emito UI components.
 *
 * Injects `--emito-*` CSS custom properties on a wrapper `<div>` and
 * distributes `appearance` and `classNames` via React context for
 * child components to consume.
 *
 * Separate from `EmitoProvider` (which manages the client connection).
 * Both can coexist:
 *
 * ```tsx
 * <EmitoProvider ...>
 *   <EmitoThemeProvider appearance={{ variables: { colorPrimary: '#6366f1' } }}>
 *     <NotificationBell />
 *   </EmitoThemeProvider>
 * </EmitoProvider>
 * ```
 */
export function EmitoThemeProvider({
	appearance = {},
	classNames = {},
	messages,
	children,
}: EmitoThemeProviderProps): ReactNode {
	const cssVars = appearanceToVars(appearance);

	// Only introduce a messages provider when overrides are given, so nesting
	// EmitoThemeProvider under an outer EmitoMessagesProvider doesn't clobber it.
	const themed = (
		<ThemeAppearanceContext.Provider value={appearance}>
			<ThemeClassNamesContext.Provider value={classNames}>
				<div style={cssVars}>{children}</div>
			</ThemeClassNamesContext.Provider>
		</ThemeAppearanceContext.Provider>
	);

	return messages ? (
		<EmitoMessagesProvider messages={messages}>{themed}</EmitoMessagesProvider>
	) : (
		themed
	);
}

/**
 * Access the current theme appearance from the nearest EmitoThemeProvider.
 */
export function useThemeAppearance(): EmitoAppearance {
	return useContext(ThemeAppearanceContext);
}

/**
 * Access the current classNames overrides from the nearest EmitoThemeProvider.
 */
export function useThemeClassNames(): EmitoClassNames {
	return useContext(ThemeClassNamesContext);
}
