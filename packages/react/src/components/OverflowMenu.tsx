import {
	FloatingPortal,
	autoUpdate,
	flip,
	offset,
	shift,
	useClick,
	useDismiss,
	useFloating,
	useInteractions,
} from "@floating-ui/react";
import { type ReactNode, useState } from "react";
import { useMessages } from "../i18n/context.js";
import styles from "../styles/inbox.module.css";
import { SnoozePicker } from "./SnoozePicker.js";

export type OverflowAction = "markAsRead" | "archive" | "snooze";

export interface OverflowMenuClassNames {
	trigger?: string;
	menu?: string;
	menuItem?: string;
}

export interface OverflowMenuProps {
	/** The notification ID for action callbacks. */
	notificationId: string;
	/** Which actions to show. Default: all three. */
	actions?: OverflowAction[];
	/** Called when "Mark as read" is selected. */
	onMarkAsRead?: (id: string) => void;
	/** Called when "Archive" is selected. */
	onArchive?: (id: string) => void;
	/** Per-slot CSS class overrides. */
	classNames?: OverflowMenuClassNames;
}

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

export function OverflowMenu({
	notificationId,
	actions = ["markAsRead", "archive", "snooze"],
	onMarkAsRead,
	onArchive,
	classNames,
}: OverflowMenuProps): ReactNode {
	const [isOpen, setIsOpen] = useState(false);
	const [showSnooze, setShowSnooze] = useState(false);
	const messages = useMessages();
	const actionLabels: Record<OverflowAction, string> = {
		markAsRead: messages.inbox.markAsRead,
		archive: messages.inbox.archive,
		snooze: messages.inbox.snooze,
	};

	const { refs, floatingStyles, context } = useFloating({
		placement: "bottom-end",
		open: isOpen,
		onOpenChange: (open) => {
			setIsOpen(open);
			if (!open) setShowSnooze(false);
		},
		middleware: [offset(4), flip(), shift()],
		whileElementsMounted: autoUpdate,
	});

	const click = useClick(context);
	const dismiss = useDismiss(context);
	const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

	function handleAction(action: OverflowAction): void {
		if (action === "markAsRead") {
			onMarkAsRead?.(notificationId);
			setIsOpen(false);
		} else if (action === "archive") {
			onArchive?.(notificationId);
			setIsOpen(false);
		} else if (action === "snooze") {
			setShowSnooze(true);
		}
	}

	return (
		<>
			<button
				ref={refs.setReference}
				type="button"
				className={joinClassNames(styles.overflowTrigger, classNames?.trigger)}
				aria-label={messages.inbox.moreActions}
				{...getReferenceProps()}
				onClick={(e) => {
					e.stopPropagation();
					const props = getReferenceProps() as { onClick?: (e: React.MouseEvent) => void };
					props.onClick?.(e);
				}}
			>
				<svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden="true">
					<circle cx="8" cy="3" r="1.5" />
					<circle cx="8" cy="8" r="1.5" />
					<circle cx="8" cy="13" r="1.5" />
				</svg>
			</button>
			{isOpen && (
				<FloatingPortal>
					<div
						ref={refs.setFloating}
						style={floatingStyles}
						className={joinClassNames(styles.overflowMenu, classNames?.menu)}
						{...getFloatingProps()}
					>
						{actions
							.filter((a) => a !== "snooze" || !showSnooze)
							.map((action) => (
								<button
									key={action}
									type="button"
									className={joinClassNames(styles.overflowMenuItem, classNames?.menuItem)}
									onClick={(e) => {
										e.stopPropagation();
										handleAction(action);
									}}
								>
									{actionLabels[action]}
								</button>
							))}
						{showSnooze && (
							<SnoozePicker notificationId={notificationId} onSelect={() => setIsOpen(false)} />
						)}
					</div>
				</FloatingPortal>
			)}
		</>
	);
}
