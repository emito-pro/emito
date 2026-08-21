import { useUnreadCount } from "@emito/react-hooks";
import { type MouseEventHandler, type ReactNode, forwardRef } from "react";
import styles from "../styles/bell.module.css";

export interface NotificationBellClassNames {
	root?: string;
	badge?: string;
	icon?: string;
}

export interface NotificationBellProps {
	/** Handler for bell click — typically wires to popover open. */
	onClick?: MouseEventHandler<HTMLButtonElement>;
	/** Show badge even when count is 0. Default: false. */
	showZero?: boolean;
	/** Maximum count to display before showing "{maxCount}+". Default: 99. */
	maxCount?: number;
	/** Per-slot CSS class overrides. */
	classNames?: NotificationBellClassNames;
	/** Convenience class for the root button element. */
	className?: string;
	/** Accessible label. Default: "Notifications". */
	"aria-label"?: string;
	/** Replace the default bell icon. Receives current unread count. */
	renderIcon?: (count: number) => ReactNode;
	/** Replace the default badge. Receives current unread count. */
	renderBadge?: (count: number) => ReactNode;
}

function formatCount(count: number, maxCount: number): string {
	return count > maxCount ? `${maxCount}+` : String(count);
}

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

/**
 * Bell icon with unread notification count badge.
 *
 * Primary trigger element for `InboxPopover`. Accepts `ref` forwarding
 * for Floating UI positioning via `refs.setReference`.
 */
export const NotificationBell = forwardRef<HTMLButtonElement, NotificationBellProps>(
	function NotificationBell(
		{
			onClick,
			showZero = false,
			maxCount = 99,
			classNames,
			className,
			"aria-label": ariaLabel = "Notifications",
			renderIcon,
			renderBadge,
		},
		ref,
	) {
		const { unreadCount } = useUnreadCount();
		const showBadge = showZero || unreadCount > 0;

		return (
			<button
				ref={ref}
				type="button"
				className={joinClassNames(styles.root, className, classNames?.root)}
				onClick={onClick}
				aria-label={ariaLabel}
			>
				{renderIcon ? (
					renderIcon(unreadCount)
				) : (
					<svg
						className={joinClassNames(styles.icon, classNames?.icon)}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={2}
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
						<path d="M13.73 21a2 2 0 0 1-3.46 0" />
					</svg>
				)}
				{showBadge &&
					(renderBadge ? (
						renderBadge(unreadCount)
					) : (
						<span className={joinClassNames(styles.badge, classNames?.badge)}>
							{formatCount(unreadCount, maxCount)}
						</span>
					))}
			</button>
		);
	},
);
