// Re-exports from @emito/react-hooks — provider and context
export { EmitoProvider, useEmitoClient } from "@emito/react-hooks";
export type { EmitoProviderProps } from "@emito/react-hooks";

// Re-exports from @emito/react-hooks — utilities
export { useClientEvent } from "@emito/react-hooks";

// Re-exports from @emito/react-hooks — hooks
export { useNotifications } from "@emito/react-hooks";
export type {
	UseNotificationsParams,
	UseNotificationsResult,
} from "@emito/react-hooks";

export { useUnreadCount } from "@emito/react-hooks";
export type { UseUnreadCountResult } from "@emito/react-hooks";

export { usePreferences } from "@emito/react-hooks";
export type {
	UsePreferencesOptions,
	UsePreferencesResult,
} from "@emito/react-hooks";

export { useToast } from "@emito/react-hooks";
export type {
	ToastItem,
	UseToastOptions,
	UseToastResult,
} from "@emito/react-hooks";

// Components
export { NotificationBell } from "./components/NotificationBell.js";
export type {
	NotificationBellClassNames,
	NotificationBellProps,
} from "./components/NotificationBell.js";

export { NotificationFeed } from "./components/NotificationFeed.js";
export type {
	FeedTab,
	NotificationFeedClassNames,
	NotificationFeedProps,
} from "./components/NotificationFeed.js";

export { NotificationInbox } from "./components/NotificationInbox.js";
export type {
	NotificationInboxClassNames,
	NotificationInboxProps,
} from "./components/NotificationInbox.js";

export { InboxPopover } from "./components/InboxPopover.js";
export type {
	InboxPopoverClassNames,
	InboxPopoverProps,
} from "./components/InboxPopover.js";

export { NotificationItem } from "./components/NotificationItem.js";
export type {
	NotificationItemClassNames,
	NotificationItemProps,
} from "./components/NotificationItem.js";

export { EmptyState } from "./components/EmptyState.js";
export type {
	EmptyStateClassNames,
	EmptyStateProps,
} from "./components/EmptyState.js";

export { OverflowMenu } from "./components/OverflowMenu.js";
export type {
	OverflowAction,
	OverflowMenuClassNames,
	OverflowMenuProps,
} from "./components/OverflowMenu.js";

export { SnoozePicker } from "./components/SnoozePicker.js";
export type { SnoozePickerProps } from "./components/SnoozePicker.js";

export { formatRelativeTime } from "./utils/relative-time.js";

export { PreferenceCenter } from "./components/PreferenceCenter.js";
export type {
	PreferenceCenterClassNames,
	PreferenceCenterProps,
	RenderRowFn,
	TopicDefinition,
} from "./components/PreferenceCenter.js";

export { PreferenceRow } from "./components/PreferenceRow.js";
export type { PreferenceRowProps } from "./components/PreferenceRow.js";

export { PreferenceToggle } from "./components/PreferenceToggle.js";
export type { PreferenceToggleProps } from "./components/PreferenceToggle.js";

export { IntegrationManager } from "./components/IntegrationManager.js";
export type {
	IntegrationManagerClassNames,
	IntegrationManagerProps,
} from "./components/IntegrationManager.js";

export { Toast } from "./components/Toast.js";
export type {
	ToastClassNames,
	ToastPosition,
	ToastProps,
} from "./components/Toast.js";

// Theme provider and utilities
export {
	EmitoThemeProvider,
	useThemeAppearance,
	useThemeClassNames,
} from "./theme/EmitoThemeProvider.js";
export { appearanceToVars } from "./theme/css-vars.js";
export type {
	EmitoAppearance,
	EmitoClassNames,
	EmitoThemeProviderProps,
	EmitoVariables,
} from "./theme/types.js";

// i18n — localizable message catalog
export { EmitoMessagesProvider, useMessages } from "./i18n/context.js";
export type { EmitoMessagesProviderProps } from "./i18n/context.js";
export { defaultMessages, mergeMessages } from "./i18n/messages.js";
export type { EmitoMessages, PartialEmitoMessages } from "./i18n/messages.js";
