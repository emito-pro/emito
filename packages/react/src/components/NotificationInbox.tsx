import { useEmitoClient } from "@emito/react-hooks";
import type { ReactNode } from "react";
import { forwardRef, useCallback } from "react";
import { useMessages } from "../i18n/context.js";
import styles from "../styles/inbox.module.css";
import {
	NotificationFeed,
	type NotificationFeedClassNames,
	type NotificationFeedProps,
} from "./NotificationFeed.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationInboxClassNames extends NotificationFeedClassNames {
	root?: string;
	header?: string;
	title?: string;
	markAllButton?: string;
	footer?: string;
	preferencesLink?: string;
}

export interface NotificationInboxProps extends Omit<NotificationFeedProps, "classNames"> {
	/** Per-slot CSS class overrides. */
	classNames?: NotificationInboxClassNames;
	/** When provided, footer renders a link navigating to this URL. */
	preferencesHref?: string;
	/** When provided, footer renders a button calling this handler. */
	onPreferencesClick?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

function GearIcon(): ReactNode {
	return (
		<svg
			viewBox="0 0 16 16"
			width={14}
			height={14}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M6.9 1.7h2.2l.3 1.6.9.4 1.4-.8 1.6 1.6-.8 1.4.4.9 1.6.3v2.2l-1.6.3-.4.9.8 1.4-1.6 1.6-1.4-.8-.9.4-.3 1.6H6.9l-.3-1.6-.9-.4-1.4.8-1.6-1.6.8-1.4-.4-.9-1.6-.3V7.1l1.6-.3.4-.9-.8-1.4 1.6-1.6 1.4.8.9-.4z" />
			<circle cx="8" cy="8" r="2" />
		</svg>
	);
}

// ---------------------------------------------------------------------------
// NotificationInbox
// ---------------------------------------------------------------------------

export const NotificationInbox = forwardRef<HTMLDivElement, NotificationInboxProps>(
	function NotificationInbox(
		{
			classNames,
			preferencesHref,
			onPreferencesClick,
			tabs,
			onNotificationClick,
			renderNotification,
			renderAvatar,
			actions,
		},
		ref,
	) {
		const client = useEmitoClient();
		const messages = useMessages();

		const handleMarkAllRead = useCallback(() => {
			client.markAllAsRead();
		}, [client]);

		const showFooter = Boolean(preferencesHref) || Boolean(onPreferencesClick);

		return (
			<div ref={ref} className={joinClassNames(styles.inboxRoot, classNames?.root)}>
				{/* Header */}
				<div className={joinClassNames(styles.inboxHeader, classNames?.header)}>
					<h2 className={joinClassNames(styles.inboxTitle, classNames?.title)}>
						{messages.inbox.title}
					</h2>
					<button
						type="button"
						className={joinClassNames(styles.inboxMarkAllButton, classNames?.markAllButton)}
						onClick={handleMarkAllRead}
					>
						{messages.inbox.markAllRead}
					</button>
				</div>

				{/* Feed */}
				<NotificationFeed
					tabs={tabs}
					onNotificationClick={onNotificationClick}
					classNames={classNames}
					renderNotification={renderNotification}
					renderAvatar={renderAvatar}
					actions={actions}
				/>

				{/* Footer */}
				{showFooter && (
					<div className={joinClassNames(styles.inboxFooter, classNames?.footer)}>
						{preferencesHref ? (
							<a
								href={preferencesHref}
								className={joinClassNames(styles.inboxPreferencesLink, classNames?.preferencesLink)}
							>
								<GearIcon />
								{messages.inbox.preferences}
							</a>
						) : (
							<button
								type="button"
								className={joinClassNames(styles.inboxPreferencesLink, classNames?.preferencesLink)}
								onClick={onPreferencesClick}
							>
								<GearIcon />
								{messages.inbox.preferences}
							</button>
						)}
					</div>
				)}
			</div>
		);
	},
);
