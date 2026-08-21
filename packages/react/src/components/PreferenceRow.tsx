import type { Channel } from "@emito/types";
import { useMessages } from "../i18n/context.js";
import styles from "../styles/preferences.module.css";
import type { PreferenceCenterClassNames, TopicDefinition } from "./PreferenceCenter.js";
import { PreferenceToggle } from "./PreferenceToggle.js";

export interface PreferenceRowProps {
	/** Topic metadata. */
	topic: TopicDefinition;
	/** All channel columns to render (superset across topics). */
	columns: Channel[];
	/** Current preference state per channel. */
	preferences: Map<Channel, boolean>;
	/** Channels locked by workspace admin (mandatory, non-toggleable). */
	lockedChannels: Set<Channel>;
	/** Whether the topic is always-enabled (transactional). */
	alwaysEnabled: boolean;
	/** Per-slot CSS class overrides. */
	classNames?: PreferenceCenterClassNames;
	/** Toggle change handler. */
	onToggle: (topicKey: string, channel: Channel, enabled: boolean) => void;
}

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

/**
 * Single topic row in the preference grid.
 *
 * Renders a label cell followed by one cell per channel column. Each cell
 * is one of: a toggle switch, a lock icon (always-enabled or admin-locked),
 * or `--` (channel not applicable to this topic).
 */
export function PreferenceRow({
	topic,
	columns,
	preferences,
	lockedChannels,
	alwaysEnabled,
	classNames,
	onToggle,
}: PreferenceRowProps) {
	const messages = useMessages();
	return (
		<tr className={joinClassNames(styles.row, classNames?.row)}>
			<td className={styles.topicLabel}>{topic.label}</td>
			{columns.map((channel) => {
				const applicable = topic.channels.includes(channel);

				if (!applicable) {
					return (
						<td key={channel} className={styles.cell}>
							<span className={styles.notApplicable}>--</span>
						</td>
					);
				}

				if (alwaysEnabled) {
					return (
						<td key={channel} className={styles.cell}>
							<span
								className={joinClassNames(styles.lockIcon, classNames?.lockIcon)}
								title={messages.preferences.locks.alwaysSent}
								aria-label={messages.preferences.locks.alwaysSent}
							>
								<LockSvg />
							</span>
						</td>
					);
				}

				if (lockedChannels.has(channel)) {
					return (
						<td key={channel} className={styles.cell}>
							<span
								className={joinClassNames(
									styles.lockIcon,
									styles.lockIconMandatory,
									classNames?.lockIcon,
								)}
								title={messages.preferences.locks.requiredByAdmin}
								aria-label={messages.preferences.locks.requiredByAdmin}
							>
								<LockSvg />
							</span>
						</td>
					);
				}

				const checked = preferences.get(channel) ?? false;

				return (
					<td key={channel} className={styles.cell}>
						<PreferenceToggle
							checked={checked}
							onChange={(enabled) => onToggle(topic.topicKey, channel, enabled)}
							className={classNames?.toggle}
							aria-label={`${topic.label} ${channel}`}
						/>
					</td>
				);
			})}
		</tr>
	);
}

function LockSvg() {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={styles.lockSvg}
		>
			<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
			<path d="M7 11V7a5 5 0 0 1 10 0v4" />
		</svg>
	);
}
