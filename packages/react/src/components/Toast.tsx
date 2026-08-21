import type { ToastItem as ToastItemType } from "@emito/react-hooks";
import { useToast } from "@emito/react-hooks";
import { Fragment, type ReactNode, forwardRef } from "react";
import { createPortal } from "react-dom";
import styles from "../styles/toast.module.css";
import { ToastItem } from "./ToastItem.js";

export type ToastPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left";

export interface ToastClassNames {
	container?: string;
	item?: string;
	closeButton?: string;
	content?: string;
}

export interface ToastProps {
	/** Stack placement. Default: "top-right". */
	position?: ToastPosition;
	/** Auto-dismiss duration in ms. Passed to useToast. Default: 5000. */
	duration?: number;
	/** Maximum visible toasts. Passed as maxSize to useToast. Default: 5. */
	maxToasts?: number;
	/** Per-slot CSS class overrides. */
	classNames?: ToastClassNames;
	/** Replace the entire toast item rendering. */
	renderToast?: (toast: ToastItemType) => ReactNode;
	/** Called when a toast body is clicked. */
	onToastClick?: (toast: ToastItemType) => void;
}

function positionClass(position: ToastPosition): string {
	switch (position) {
		case "top-right":
			return styles.topRight ?? "";
		case "top-left":
			return styles.topLeft ?? "";
		case "bottom-right":
			return styles.bottomRight ?? "";
		case "bottom-left":
			return styles.bottomLeft ?? "";
	}
}

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

/**
 * Toast notification stack.
 *
 * Renders toast notifications via `createPortal` to `document.body`.
 * Consumes the `useToast()` hook for queue management and auto-dismiss.
 * Toasts stack vertically — newest on top for `top-*` positions,
 * newest on bottom for `bottom-*` positions.
 */
export const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast(
	{ position = "top-right", duration, maxToasts, classNames, renderToast, onToastClick },
	ref,
) {
	const { toasts, dismiss } = useToast({ duration, maxSize: maxToasts });

	// Newest on top for top-* positions, as-is (newest at bottom) for bottom-*
	const isTopPosition = position === "top-right" || position === "top-left";
	const orderedToasts = isTopPosition ? [...toasts].reverse() : toasts;

	const container = (
		<div
			ref={ref}
			className={joinClassNames(styles.container, positionClass(position), classNames?.container)}
			data-emito-toast-position={position}
		>
			{orderedToasts.map((toast) =>
				renderToast ? (
					<Fragment key={toast.id}>{renderToast(toast)}</Fragment>
				) : (
					<ToastItem
						key={toast.id}
						toast={toast}
						onClose={dismiss}
						onToastClick={onToastClick}
						classNames={{
							item: classNames?.item,
							closeButton: classNames?.closeButton,
							content: classNames?.content,
						}}
					/>
				),
			)}
		</div>
	);

	return createPortal(container, document.body);
});
