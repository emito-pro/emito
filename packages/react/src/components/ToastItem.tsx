import type { ToastItem as ToastItemType } from "@emito/react-hooks";
import { type MouseEvent, forwardRef } from "react";
import styles from "../styles/toast.module.css";

export interface ToastItemClassNames {
	item?: string;
	content?: string;
	closeButton?: string;
}

export interface ToastItemProps {
	/** The toast data to render. */
	toast: ToastItemType;
	/** Called when the close button is clicked. */
	onClose: (id: string) => void;
	/** Called when the toast body is clicked. */
	onToastClick?: (toast: ToastItemType) => void;
	/** Per-slot CSS class overrides. */
	classNames?: ToastItemClassNames;
}

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

/**
 * Individual toast notification card.
 *
 * Renders subject, body, avatar, a close button, and an optional
 * primary action button. Used internally by `Toast`.
 */
export const ToastItem = forwardRef<HTMLDivElement, ToastItemProps>(function ToastItem(
	{ toast, onClose, onToastClick, classNames },
	ref,
) {
	const handleClose = (e: MouseEvent) => {
		e.stopPropagation();
		onClose(toast.id);
	};

	const handleActionClick = (e: MouseEvent) => {
		e.stopPropagation();
		if (toast.primaryAction?.url) {
			window.open(toast.primaryAction.url, "_blank", "noopener");
		}
	};

	return (
		<div
			ref={ref}
			className={joinClassNames(styles.item, classNames?.item)}
			onClick={() => onToastClick?.(toast)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onToastClick?.(toast);
				}
			}}
			role="alert"
		>
			{/* Avatar */}
			{toast.avatar ? (
				<img className={styles.avatar} src={toast.avatar} alt="" />
			) : (
				<div className={styles.avatarFallback} aria-hidden="true">
					<svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden="true">
						<path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 14s0-4 6-4 6 4 6 4H2Z" />
					</svg>
				</div>
			)}

			{/* Content */}
			<div className={joinClassNames(styles.content, classNames?.content)}>
				{toast.subject && <div className={styles.subject}>{toast.subject}</div>}
				<p className={styles.body}>{toast.body}</p>

				{/* Primary action button */}
				{toast.primaryAction && (
					<button type="button" className={styles.actionButton} onClick={handleActionClick}>
						{toast.primaryAction.label}
					</button>
				)}
			</div>

			{/* Close button */}
			<button
				type="button"
				className={joinClassNames(styles.closeButton, classNames?.closeButton)}
				onClick={handleClose}
				aria-label="Dismiss"
			>
				<svg
					viewBox="0 0 16 16"
					width={14}
					height={14}
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					strokeLinecap="round"
					aria-hidden="true"
				>
					<path d="M4 4l8 8M12 4l-8 8" />
				</svg>
			</button>
		</div>
	);
});
