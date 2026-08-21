import type { NotificationItem as NotificationItemType } from "@emito/js";
import { type ReactNode, forwardRef } from "react";
import styles from "../styles/inbox.module.css";
import { formatRelativeTime } from "../utils/relative-time.js";
import { type OverflowAction, OverflowMenu } from "./OverflowMenu.js";

export interface NotificationItemClassNames {
	item?: string;
	avatar?: string;
	subject?: string;
	body?: string;
	timestamp?: string;
	actions?: string;
	unreadDot?: string;
	overflowMenu?: string;
}

export interface NotificationItemProps {
	/** The notification data to render. */
	notification: NotificationItemType;
	/** Called when the item is clicked. */
	onClick?: (notification: NotificationItemType) => void;
	/** Called when "Mark as read" is selected from overflow menu. */
	onMarkAsRead?: (id: string) => void;
	/** Called when "Archive" is selected from overflow menu. */
	onArchive?: (id: string) => void;
	/** Per-slot CSS class overrides. */
	classNames?: NotificationItemClassNames;
	/** Replace the avatar element. */
	renderAvatar?: (notification: NotificationItemType) => ReactNode;
	/** Which overflow menu actions to show. Default: all three. */
	actions?: OverflowAction[];
}

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

export const NotificationItem = forwardRef<HTMLDivElement, NotificationItemProps>(
	function NotificationItem(
		{ notification, onClick, onMarkAsRead, onArchive, classNames, renderAvatar, actions },
		ref,
	) {
		const isUnread = notification.readAt == null;

		return (
			<div
				ref={ref}
				className={joinClassNames(styles.item, classNames?.item)}
				onClick={() => onClick?.(notification)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onClick?.(notification);
					}
				}}
			>
				{/* Avatar */}
				{renderAvatar ? (
					renderAvatar(notification)
				) : notification.avatar ? (
					<img
						className={joinClassNames(styles.avatar, classNames?.avatar)}
						src={notification.avatar}
						alt=""
					/>
				) : (
					<div
						className={joinClassNames(styles.avatarFallback, classNames?.avatar)}
						aria-hidden="true"
					>
						<svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden="true">
							<path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 14s0-4 6-4 6 4 6 4H2Z" />
						</svg>
					</div>
				)}

				{/* Content */}
				<div className={styles.content}>
					<div className={styles.header}>
						<span
							className={joinClassNames(
								styles.subject,
								isUnread ? styles.subjectUnread : undefined,
								classNames?.subject,
							)}
						>
							{notification.subject ?? notification.event}
						</span>
						<span className={joinClassNames(styles.timestamp, classNames?.timestamp)}>
							{formatRelativeTime(notification.createdAt)}
						</span>
					</div>
					<p className={joinClassNames(styles.body, classNames?.body)}>{notification.body}</p>

					{/* Action buttons */}
					{(notification.primaryAction || notification.secondaryAction) && (
						<div className={joinClassNames(styles.actions, classNames?.actions)}>
							{notification.primaryAction && (
								<button
									type="button"
									className={styles.actionButton}
									onClick={(e) => {
										e.stopPropagation();
										if (notification.primaryAction?.url) {
											window.open(notification.primaryAction.url, "_blank", "noopener");
										}
									}}
								>
									{notification.primaryAction.label}
								</button>
							)}
							{notification.secondaryAction && (
								<button
									type="button"
									className={styles.actionButton}
									onClick={(e) => {
										e.stopPropagation();
										if (notification.secondaryAction?.url) {
											window.open(notification.secondaryAction.url, "_blank", "noopener");
										}
									}}
								>
									{notification.secondaryAction.label}
								</button>
							)}
						</div>
					)}
				</div>

				{/* Unread dot */}
				{isUnread && <div className={joinClassNames(styles.unreadDot, classNames?.unreadDot)} />}

				{/* Overflow menu */}
				<OverflowMenu
					notificationId={notification.id}
					actions={actions}
					onMarkAsRead={onMarkAsRead}
					onArchive={onArchive}
					classNames={classNames?.overflowMenu ? { trigger: classNames.overflowMenu } : undefined}
				/>
			</div>
		);
	},
);
