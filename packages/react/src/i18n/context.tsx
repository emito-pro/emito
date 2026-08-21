import { type ReactNode, createContext, useContext, useMemo } from "react";
import {
	type EmitoMessages,
	type PartialEmitoMessages,
	defaultMessages,
	mergeMessages,
} from "./messages.js";

const MessagesContext = createContext<EmitoMessages>(defaultMessages);

export interface EmitoMessagesProviderProps {
	/** Partial overrides deep-merged over the English defaults. */
	messages?: PartialEmitoMessages;
	children: ReactNode;
}

/**
 * Provides localized copy for Emito UI components. Wrap your inbox/preferences
 * subtree (or pass `messages` to `EmitoThemeProvider`, which renders this for
 * you). Components read the merged catalog via {@link useMessages}.
 */
export function EmitoMessagesProvider({
	messages,
	children,
}: EmitoMessagesProviderProps): ReactNode {
	const value = useMemo(() => mergeMessages(messages), [messages]);
	return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}

/**
 * Access the merged message catalog from the nearest provider. Returns the
 * English defaults when no provider is present.
 */
export function useMessages(): EmitoMessages {
	return useContext(MessagesContext);
}
