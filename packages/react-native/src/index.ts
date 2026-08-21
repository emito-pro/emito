// Re-export all hooks from @emito/react-hooks
export {
	EmitoProvider,
	useEmitoClient,
	useNotifications,
	useUnreadCount,
	usePreferences,
	useToast,
} from "@emito/react-hooks";
export type {
	EmitoProviderProps,
	UseNotificationsParams,
	UseNotificationsResult,
	UseUnreadCountResult,
	UsePreferencesOptions,
	UsePreferencesResult,
	ToastItem,
	UseToastOptions,
	UseToastResult,
} from "@emito/react-hooks";

// React Native specific hooks
export { usePushToken } from "./use-push-token.js";
export type {
	PushPlatform,
	UsePushTokenOptions,
	UsePushTokenResult,
} from "./use-push-token.js";
