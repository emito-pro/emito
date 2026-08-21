import {
	FloatingFocusManager,
	FloatingPortal,
	type Placement,
	autoUpdate,
	flip,
	offset,
	shift,
	useClick,
	useDismiss,
	useFloating,
	useInteractions,
	useRole,
} from "@floating-ui/react";
import { type ReactElement, type ReactNode, cloneElement, forwardRef, useState } from "react";
import styles from "../styles/inbox.module.css";
import {
	NotificationInbox,
	type NotificationInboxClassNames,
	type NotificationInboxProps,
} from "./NotificationInbox.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboxPopoverClassNames extends NotificationInboxClassNames {
	popover?: string;
}

export interface InboxPopoverProps extends Omit<NotificationInboxProps, "classNames"> {
	/** Trigger element — typically <NotificationBell />. Must support ref forwarding. */
	bell: ReactElement;
	/** Popover placement relative to the trigger. Default: "bottom-end". */
	placement?: Placement;
	/** Called when the popover opens or closes. */
	onOpenChange?: (open: boolean) => void;
	/** Per-slot CSS class overrides. */
	classNames?: InboxPopoverClassNames;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// InboxPopover
// ---------------------------------------------------------------------------

export const InboxPopover = forwardRef<HTMLDivElement, InboxPopoverProps>(function InboxPopover(
	{
		bell,
		placement = "bottom-end",
		onOpenChange: onOpenChangeProp,
		classNames,
		// NotificationInbox passthrough props
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
	const [isOpen, setIsOpen] = useState(false);

	const handleOpenChange = (open: boolean): void => {
		setIsOpen(open);
		onOpenChangeProp?.(open);
	};

	const { refs, floatingStyles, context } = useFloating({
		open: isOpen,
		onOpenChange: handleOpenChange,
		placement,
		middleware: [offset(8), flip(), shift()],
		whileElementsMounted: autoUpdate,
	});

	const click = useClick(context);
	const dismiss = useDismiss(context);
	const role = useRole(context);

	const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

	// Wire the bell trigger with ref + interaction props
	const trigger = cloneElement(bell, {
		ref: refs.setReference,
		...getReferenceProps(),
	});

	return (
		<>
			{trigger}
			{isOpen && (
				<FloatingPortal>
					<FloatingFocusManager context={context} modal={false}>
						<div
							ref={(node) => {
								refs.setFloating(node);
								if (typeof ref === "function") {
									ref(node);
								} else if (ref) {
									(ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
								}
							}}
							style={floatingStyles}
							className={joinClassNames(classNames?.popover)}
							{...getFloatingProps()}
						>
							<NotificationInbox
								classNames={classNames}
								preferencesHref={preferencesHref}
								onPreferencesClick={onPreferencesClick}
								tabs={tabs}
								onNotificationClick={onNotificationClick}
								renderNotification={renderNotification}
								renderAvatar={renderAvatar}
								actions={actions}
							/>
						</div>
					</FloatingFocusManager>
				</FloatingPortal>
			)}
		</>
	);
});
