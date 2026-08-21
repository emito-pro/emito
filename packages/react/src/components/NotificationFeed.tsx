import type { NotificationItem as NotificationItemType } from "@emito/js";
import { useNotifications } from "@emito/react-hooks";
import type { UseNotificationsParams } from "@emito/react-hooks";
import { type ReactNode, forwardRef, useCallback, useRef, useState } from "react";
import styles from "../styles/inbox.module.css";
import { EmptyState } from "./EmptyState.js";
import { NotificationItem, type NotificationItemClassNames } from "./NotificationItem.js";
import type { OverflowAction } from "./OverflowMenu.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedTab {
	label: string;
	filter?: {
		status?: string;
		category?: string;
	};
}

export interface NotificationFeedClassNames extends NotificationItemClassNames {
	feed?: string;
	tabBar?: string;
	tab?: string;
	activeTab?: string;
	skeleton?: string;
	emptyState?: string;
}

export interface NotificationFeedProps {
	/** Tab definitions. When provided, a tab bar renders above the list. */
	tabs?: FeedTab[];
	/** Called when a notification row is clicked. */
	onNotificationClick?: (notification: NotificationItemType) => void;
	/** Per-slot CSS class overrides. */
	classNames?: NotificationFeedClassNames;
	/** Replace the entire notification row rendering. */
	renderNotification?: (
		notification: NotificationItemType,
		helpers: { onClick: () => void },
	) => ReactNode;
	/** Replace the avatar element in each notification row. */
	renderAvatar?: (notification: NotificationItemType) => ReactNode;
	/** Which overflow menu actions to show on each item. */
	actions?: OverflowAction[];
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonItem({ className }: { className?: string }): ReactNode {
	return (
		<div className={className ?? styles.skeleton}>
			<div className={styles.skeletonAvatar} />
			<div className={styles.skeletonContent}>
				<div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
				<div className={`${styles.skeletonLine} ${styles.skeletonLineLong}`} />
				<div className={`${styles.skeletonLine} ${styles.skeletonLineMedium}`} />
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// NotificationFeed
// ---------------------------------------------------------------------------

const SCROLL_THRESHOLD = 100;

export const NotificationFeed = forwardRef<HTMLDivElement, NotificationFeedProps>(
	function NotificationFeed(
		{ tabs, onNotificationClick, classNames, renderNotification, renderAvatar, actions },
		ref,
	) {
		const [activeTabIndex, setActiveTabIndex] = useState(0);

		// Derive hook params from active tab
		const activeTab = tabs?.[activeTabIndex];
		const hookParams: UseNotificationsParams | undefined = activeTab?.filter
			? {
					status: activeTab.filter.status,
					category: activeTab.filter.category,
				}
			: undefined;

		const { notifications, isLoading, hasMore, fetchMore, markAsRead, archive } =
			useNotifications(hookParams);

		// Infinite scroll — guard against duplicate in-flight fetchMore calls
		const fetchingRef = useRef(false);
		const handleScroll = useCallback(
			(e: React.UIEvent<HTMLDivElement>) => {
				const el = e.currentTarget;
				const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

				if (distanceFromBottom < SCROLL_THRESHOLD && hasMore && !fetchingRef.current) {
					fetchingRef.current = true;
					fetchMore().finally(() => {
						fetchingRef.current = false;
					});
				}
			},
			[hasMore, fetchMore],
		);

		function joinCls(...parts: (string | undefined)[]): string {
			return parts.filter(Boolean).join(" ");
		}

		return (
			<div ref={ref} className={joinCls(styles.feed, classNames?.feed)} onScroll={handleScroll}>
				{/* Tab bar */}
				{tabs && tabs.length > 0 && (
					<div className={joinCls(styles.tabBar, classNames?.tabBar)} role="tablist">
						{tabs.map((tab, index) => (
							<button
								key={tab.label}
								type="button"
								role="tab"
								aria-selected={index === activeTabIndex}
								className={joinCls(
									styles.tab,
									index === activeTabIndex ? styles.tabActive : undefined,
									classNames?.tab,
									index === activeTabIndex ? classNames?.activeTab : undefined,
								)}
								onClick={() => setActiveTabIndex(index)}
							>
								{tab.label}
							</button>
						))}
					</div>
				)}

				{/* Content */}
				{isLoading ? (
					<>
						<SkeletonItem className={joinCls(styles.skeleton, classNames?.skeleton)} />
						<SkeletonItem className={joinCls(styles.skeleton, classNames?.skeleton)} />
						<SkeletonItem className={joinCls(styles.skeleton, classNames?.skeleton)} />
					</>
				) : notifications.length === 0 ? (
					<EmptyState
						classNames={classNames?.emptyState ? { root: classNames.emptyState } : undefined}
					/>
				) : (
					notifications.map((notification) =>
						renderNotification ? (
							<div key={notification.id}>
								{renderNotification(notification, {
									onClick: () => onNotificationClick?.(notification),
								})}
							</div>
						) : (
							<NotificationItem
								key={notification.id}
								notification={notification}
								onClick={onNotificationClick}
								onMarkAsRead={markAsRead}
								onArchive={archive}
								classNames={classNames}
								renderAvatar={renderAvatar}
								actions={actions}
							/>
						),
					)
				)}
			</div>
		);
	},
);
