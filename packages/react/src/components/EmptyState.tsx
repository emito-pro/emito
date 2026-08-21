import type { ReactNode } from "react";
import { useMessages } from "../i18n/context.js";
import styles from "../styles/inbox.module.css";

export interface EmptyStateClassNames {
	root?: string;
	icon?: string;
	title?: string;
	message?: string;
}

export interface EmptyStateProps {
	/** Heading text. Default: "No notifications yet". */
	title?: string;
	/** Supporting message. Default: "You're all caught up!..." */
	message?: string;
	/** Per-slot CSS class overrides. */
	classNames?: EmptyStateClassNames;
	/** Replace the default inbox icon. */
	renderIcon?: () => ReactNode;
}

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

export function EmptyState({ title, message, classNames, renderIcon }: EmptyStateProps): ReactNode {
	const messages = useMessages();
	const resolvedTitle = title ?? messages.inbox.emptyTitle;
	const resolvedMessage = message ?? messages.inbox.emptyMessage;
	return (
		<div className={joinClassNames(styles.emptyState, classNames?.root)}>
			{renderIcon ? (
				renderIcon()
			) : (
				<svg
					className={joinClassNames(styles.emptyStateIcon, classNames?.icon)}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth={1.5}
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<rect x="2" y="4" width="20" height="16" rx="2" />
					<path d="M12 8v4M12 16h.01" />
				</svg>
			)}
			<h3 className={joinClassNames(styles.emptyStateTitle, classNames?.title)}>{resolvedTitle}</h3>
			<p className={joinClassNames(styles.emptyStateMessage, classNames?.message)}>
				{resolvedMessage}
			</p>
		</div>
	);
}
