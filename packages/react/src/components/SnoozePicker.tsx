import { useEmitoClient } from "@emito/react-hooks";
import type { ReactNode } from "react";
import { useMessages } from "../i18n/context.js";
import styles from "../styles/inbox.module.css";

export interface SnoozePickerProps {
	/** The notification ID to snooze. */
	notificationId: string;
	/** Called after a snooze option is selected. */
	onSelect?: () => void;
	/** Per-slot CSS class overrides. */
	classNames?: {
		root?: string;
		label?: string;
		option?: string;
	};
}

type SnoozeOptionKey = "fifteenMinutes" | "oneHour" | "fourHours" | "tomorrow" | "nextWeek";

interface SnoozeOption {
	key: SnoozeOptionKey;
	getUntil: () => Date;
}

function getNextMorning(daysFromNow: number): Date {
	const d = new Date();
	d.setDate(d.getDate() + daysFromNow);
	d.setHours(9, 0, 0, 0);
	return d;
}

function getNextMonday9am(): Date {
	const d = new Date();
	const day = d.getDay();
	// days until next Monday: if today is Monday (1), advance 7; otherwise advance to next Monday
	const daysUntilMonday = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
	d.setDate(d.getDate() + daysUntilMonday);
	d.setHours(9, 0, 0, 0);
	return d;
}

const SNOOZE_OPTIONS: SnoozeOption[] = [
	{ key: "fifteenMinutes", getUntil: () => new Date(Date.now() + 900_000) },
	{ key: "oneHour", getUntil: () => new Date(Date.now() + 3_600_000) },
	{ key: "fourHours", getUntil: () => new Date(Date.now() + 14_400_000) },
	{ key: "tomorrow", getUntil: () => getNextMorning(1) },
	{ key: "nextWeek", getUntil: getNextMonday9am },
];

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

export function SnoozePicker({
	notificationId,
	onSelect,
	classNames,
}: SnoozePickerProps): ReactNode {
	const client = useEmitoClient();
	const messages = useMessages();

	function handleSnooze(option: SnoozeOption): void {
		const until = option.getUntil();
		client.notifications.snooze(notificationId, until).then(() => {
			client.emit("snoozed", notificationId);
		});
		onSelect?.();
	}

	return (
		<div className={joinClassNames(styles.snoozePicker, classNames?.root)}>
			<div className={joinClassNames(styles.snoozePickerLabel, classNames?.label)}>
				{messages.snooze.until}
			</div>
			{SNOOZE_OPTIONS.map((option) => (
				<button
					key={option.key}
					type="button"
					className={joinClassNames(styles.snoozeOption, classNames?.option)}
					onClick={() => handleSnooze(option)}
				>
					{messages.snooze[option.key]}
				</button>
			))}
		</div>
	);
}
