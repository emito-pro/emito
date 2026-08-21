/**
 * User-facing strings for Emito's React components.
 *
 * Components read their copy from this catalog via `useMessages()` so consumers
 * can localize the UI. Consumers supply a (deep-)partial override through
 * `EmitoMessagesProvider` (or `EmitoThemeProvider`'s `messages` prop); anything
 * omitted falls back to the English defaults below.
 */
export interface EmitoMessages {
	preferences: {
		/** Heading when not in workspace mode. */
		title: string;
		/** Heading when a `workspaceId` is set. */
		workspaceTitle: string;
		/** Category section labels, keyed by category. Known keys have defaults; additional keys are accepted. */
		categories: Record<string, string> & {
			transactional: string;
			product: string;
			marketing: string;
		};
		/** Column headers, keyed by channel. */
		channels: {
			email: string;
			push: string;
			sms: string;
			inApp: string;
		};
		/** PreferenceRow lock-icon title/aria-label, keyed by lock reason. */
		locks: {
			alwaysSent: string;
			requiredByAdmin: string;
		};
	};
	inbox: {
		/** NotificationInbox header heading. */
		title: string;
		/** NotificationInbox header bulk-action button. */
		markAllRead: string;
		markAsRead: string;
		archive: string;
		snooze: string;
		/** EmptyState heading. */
		emptyTitle: string;
		/** EmptyState supporting message. */
		emptyMessage: string;
		/** NotificationInbox footer link/button to the preference center. */
		preferences: string;
		/** OverflowMenu trigger button aria-label. */
		moreActions: string;
	};
	/** SnoozePicker label + option copy. */
	snooze: {
		until: string;
		fifteenMinutes: string;
		oneHour: string;
		fourHours: string;
		tomorrow: string;
		nextWeek: string;
	};
	/** IntegrationManager copy. */
	integrations: {
		title: string;
		add: string;
		remove: string;
		loading: string;
		empty: string;
	};
}

/** A deep-partial of {@link EmitoMessages} — consumers override only what they need. */
export interface PartialEmitoMessages {
	preferences?: {
		title?: string;
		workspaceTitle?: string;
		categories?: Record<string, string>;
		channels?: Partial<EmitoMessages["preferences"]["channels"]>;
		locks?: Partial<EmitoMessages["preferences"]["locks"]>;
	};
	inbox?: Partial<EmitoMessages["inbox"]>;
	snooze?: Partial<EmitoMessages["snooze"]>;
	integrations?: Partial<EmitoMessages["integrations"]>;
}

/** English defaults. */
export const defaultMessages: EmitoMessages = {
	preferences: {
		title: "Notification Preferences",
		workspaceTitle: "Notification Preferences — Workspace",
		categories: {
			transactional: "Security & Transactional",
			product: "Product Updates",
			marketing: "Marketing",
		},
		channels: {
			email: "Email",
			push: "Push",
			sms: "SMS",
			inApp: "In-App",
		},
		locks: {
			alwaysSent: "Always sent",
			requiredByAdmin: "Required by your workspace admin",
		},
	},
	inbox: {
		title: "Notifications",
		markAllRead: "Mark all read",
		markAsRead: "Mark as read",
		archive: "Archive",
		snooze: "Snooze",
		emptyTitle: "No notifications yet",
		emptyMessage: "You're all caught up! We'll let you know when something needs your attention.",
		preferences: "Preferences",
		moreActions: "More actions",
	},
	snooze: {
		until: "Snooze until",
		fifteenMinutes: "15 minutes",
		oneHour: "1 hour",
		fourHours: "4 hours",
		tomorrow: "Tomorrow",
		nextWeek: "Next week",
	},
	integrations: {
		title: "Integrations",
		add: "Add integration",
		remove: "Remove",
		loading: "Loading integrations...",
		empty: "No integrations connected.",
	},
};

/**
 * Deep-merge a partial override over {@link defaultMessages}. Two levels deep,
 * matching the shape of {@link EmitoMessages} — enough for the catalog, without
 * pulling in a generic deep-merge dependency.
 */
export function mergeMessages(partial?: PartialEmitoMessages): EmitoMessages {
	if (!partial) return defaultMessages;
	return {
		preferences: {
			...defaultMessages.preferences,
			...partial.preferences,
			categories: {
				...defaultMessages.preferences.categories,
				...partial.preferences?.categories,
			},
			channels: {
				...defaultMessages.preferences.channels,
				...partial.preferences?.channels,
			},
			locks: {
				...defaultMessages.preferences.locks,
				...partial.preferences?.locks,
			},
		},
		inbox: {
			...defaultMessages.inbox,
			...partial.inbox,
		},
		snooze: {
			...defaultMessages.snooze,
			...partial.snooze,
		},
		integrations: {
			...defaultMessages.integrations,
			...partial.integrations,
		},
	};
}
