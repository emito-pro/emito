// Provider and context
export { EmitoProvider, useEmitoClient } from "./context.js";
export type { EmitoProviderProps } from "./context.js";

// Utilities
export { useClientEvent } from "./useClientEvent.js";

// Hooks
export { useNotifications } from "./useNotifications.js";
export type {
	UseNotificationsParams,
	UseNotificationsResult,
} from "./useNotifications.js";

export { useUnreadCount } from "./useUnreadCount.js";
export type { UseUnreadCountResult } from "./useUnreadCount.js";

export { usePreferences } from "./usePreferences.js";
export type {
	UsePreferencesOptions,
	UsePreferencesResult,
} from "./usePreferences.js";

export { useToast } from "./useToast.js";
export type {
	ToastItem,
	UseToastOptions,
	UseToastResult,
} from "./useToast.js";
