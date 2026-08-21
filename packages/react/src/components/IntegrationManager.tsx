import type { Integration } from "@emito/js";
import { useMessages } from "../i18n/context.js";
import styles from "../styles/preferences.module.css";

export interface IntegrationManagerClassNames {
	integrations?: string;
}

export interface IntegrationManagerProps {
	/** List of personal integrations to display. */
	integrations: Integration[];
	/** Whether the integration list is still loading. */
	isLoading?: boolean;
	/** Per-slot CSS class overrides. */
	classNames?: IntegrationManagerClassNames;
	/** Called when the user clicks "Add integration". */
	onAdd?: () => void;
	/** Called when the user clicks "Remove" on an integration. */
	onRemove?: (id: string) => void;
}

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

/**
 * Personal integration list with add/remove actions.
 *
 * Displays connected integrations (Slack, Telegram, Discord, etc.) and
 * allows removal. Presentational component — data fetching is handled
 * by the parent or the consumer.
 */
export function IntegrationManager({
	integrations,
	isLoading = false,
	classNames,
	onAdd,
	onRemove,
}: IntegrationManagerProps) {
	const messages = useMessages();
	return (
		<div className={joinClassNames(styles.integrations, classNames?.integrations)}>
			<div className={styles.integrationHeader}>
				<h3 className={styles.integrationTitle}>{messages.integrations.title}</h3>
				{onAdd && (
					<button type="button" className={styles.integrationAddBtn} onClick={onAdd}>
						{messages.integrations.add}
					</button>
				)}
			</div>

			{isLoading && <p className={styles.integrationLoading}>{messages.integrations.loading}</p>}

			{!isLoading && integrations.length === 0 && (
				<p className={styles.integrationEmpty}>{messages.integrations.empty}</p>
			)}

			{!isLoading && integrations.length > 0 && (
				<ul className={styles.integrationList}>
					{integrations.map((integration) => (
						<li key={integration.id} className={styles.integrationItem}>
							<span className={styles.integrationChannel}>{integration.channel}</span>
							<span className={styles.integrationName}>{integration.name}</span>
							{onRemove && (
								<button
									type="button"
									className={styles.integrationRemoveBtn}
									onClick={() => onRemove(integration.id)}
									aria-label={`${messages.integrations.remove} ${integration.name}`}
								>
									{messages.integrations.remove}
								</button>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
