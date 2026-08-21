import type { Integration } from "@emito/js";
import { useEmitoClient, usePreferences } from "@emito/react-hooks";
import type { Channel, WorkspaceDefault } from "@emito/types";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "../i18n/context.js";
import styles from "../styles/preferences.module.css";
import { IntegrationManager } from "./IntegrationManager.js";
import { PreferenceRow } from "./PreferenceRow.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TopicDefinition {
	topicKey: string;
	label: string;
	category: string;
	channels: Channel[];
}

export interface PreferenceCenterClassNames {
	grid?: string;
	categoryHeader?: string;
	row?: string;
	toggle?: string;
	lockIcon?: string;
	integrations?: string;
}

export type RenderRowFn = (
	topic: TopicDefinition,
	preferences: Map<Channel, boolean>,
	lockedChannels: Set<Channel>,
	alwaysEnabled: boolean,
) => ReactNode;

export interface PreferenceCenterProps {
	/** Topic catalog — provides category grouping and available channels. */
	topics: TopicDefinition[];
	/** Activate workspace-scoped mode. */
	workspaceId?: string;
	/** Workspace admin mandatory restrictions (from WorkspaceDefault records). */
	workspaceDefaults?: WorkspaceDefault[];
	/** Show IntegrationManager section. Default: false. */
	showIntegrations?: boolean;
	/** Per-slot CSS class overrides. */
	classNames?: PreferenceCenterClassNames;
	/** Convenience class for the root element. */
	className?: string;
	/** Replace the default row rendering for each topic. */
	renderRow?: RenderRowFn;
	/** Called when the user clicks "Unsubscribe from all non-essential emails". */
	onUnsubscribeAll?: () => void;
	/** Called when the user clicks "Add integration" in the IntegrationManager. */
	onAddIntegration?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function joinClassNames(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

/** Known categories rendered first, in this order; any additional categories follow alphabetically. */
const KNOWN_CATEGORY_ORDER = ["transactional", "product", "marketing"];

function humanize(key: string): string {
	return key.charAt(0).toUpperCase() + key.slice(1).replace(/[_-]/g, " ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Channel preference grid with workspace-scoped mandatory locks.
 *
 * Renders notification topics grouped by category with per-channel toggle
 * switches. Supports workspace mode via `workspaceId`, mandatory admin
 * restrictions via `workspaceDefaults`, and an optional IntegrationManager
 * section for personal integrations.
 */
export function PreferenceCenter({
	topics,
	workspaceId,
	workspaceDefaults,
	showIntegrations = false,
	classNames,
	className,
	renderRow,
	onUnsubscribeAll,
	onAddIntegration,
}: PreferenceCenterProps) {
	const client = useEmitoClient();
	const clientRef = useRef(client);
	clientRef.current = client;
	const messages = useMessages();
	const { preferences, updatePreference } = usePreferences({ workspaceId });

	// Integration state (fetched once when showIntegrations is enabled)
	const [integrationList, setIntegrationList] = useState<Integration[]>([]);
	const [integrationsLoading, setIntegrationsLoading] = useState(false);

	useEffect(() => {
		if (!showIntegrations) return;
		setIntegrationsLoading(true);
		clientRef.current.integrations
			.list()
			.then((result) => {
				setIntegrationList(result.items);
				setIntegrationsLoading(false);
			})
			.catch(() => setIntegrationsLoading(false));
	}, [showIntegrations]);

	const handleRemoveIntegration = useCallback(async (id: string) => {
		await clientRef.current.integrations.deactivate(id);
		setIntegrationList((prev) => prev.filter((i) => i.id !== id));
	}, []);

	// Derive channel columns from the union of all topic channels
	const columns = useMemo(() => {
		const channelSet = new Set<Channel>();
		for (const topic of topics) {
			for (const ch of topic.channels) {
				channelSet.add(ch);
			}
		}
		return Array.from(channelSet);
	}, [topics]);

	// Group topics by category
	const grouped = useMemo(() => {
		const map = new Map<string, TopicDefinition[]>();
		for (const topic of topics) {
			const list = map.get(topic.category) ?? [];
			list.push(topic);
			map.set(topic.category, list);
		}
		return map;
	}, [topics]);

	// Build preference lookup: topicKey → channel → enabled
	const prefLookup = useMemo(() => {
		const map = new Map<string, Map<Channel, boolean>>();
		for (const pref of preferences) {
			let channelMap = map.get(pref.topicKey);
			if (!channelMap) {
				channelMap = new Map();
				map.set(pref.topicKey, channelMap);
			}
			channelMap.set(pref.channel, pref.enabled);
		}
		return map;
	}, [preferences]);

	// Build mandatory lock lookup: topicKey → Set<Channel>
	const mandatoryLocks = useMemo(() => {
		const map = new Map<string, Set<Channel>>();
		if (!workspaceDefaults) return map;
		for (const wd of workspaceDefaults) {
			if (!wd.isMandatory) continue;
			let channelSet = map.get(wd.topicKey);
			if (!channelSet) {
				channelSet = new Set();
				map.set(wd.topicKey, channelSet);
			}
			channelSet.add(wd.channel);
		}
		return map;
	}, [workspaceDefaults]);

	const handleToggle = useCallback(
		(topicKey: string, channel: Channel, enabled: boolean) => {
			updatePreference({ topicKey, channel, enabled });
		},
		[updatePreference],
	);

	const orderedCategories = useMemo(() => {
		const known = KNOWN_CATEGORY_ORDER.filter((k) => grouped.has(k));
		const rest = Array.from(grouped.keys())
			.filter((k) => !KNOWN_CATEGORY_ORDER.includes(k))
			.sort();
		return [...known, ...rest];
	}, [grouped]);

	return (
		<div className={joinClassNames(styles.root, className)}>
			<h2 className={styles.title}>
				{workspaceId ? messages.preferences.workspaceTitle : messages.preferences.title}
			</h2>

			<table className={joinClassNames(styles.grid, classNames?.grid)}>
				<thead>
					<tr>
						<th className={styles.columnHeader} />
						{columns.map((channel) => (
							<th key={channel} className={styles.columnHeader}>
								{formatChannelLabel(channel, messages.preferences.channels)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{orderedCategories.map((key) => {
						const categoryTopics = grouped.get(key);
						if (!categoryTopics || categoryTopics.length === 0) return null;
						const alwaysEnabled = key === "transactional";
						const label = messages.preferences.categories[key] ?? humanize(key);

						return (
							<CategorySection
								key={key}
								label={label}
								topics={categoryTopics}
								columns={columns}
								prefLookup={prefLookup}
								mandatoryLocks={mandatoryLocks}
								alwaysEnabled={alwaysEnabled}
								classNames={classNames}
								onToggle={handleToggle}
								renderRow={renderRow}
							/>
						);
					})}
				</tbody>
			</table>

			{onUnsubscribeAll && (
				<button type="button" className={styles.unsubscribeBtn} onClick={onUnsubscribeAll}>
					Unsubscribe from all non-essential emails
				</button>
			)}

			{showIntegrations && (
				<IntegrationManager
					integrations={integrationList}
					isLoading={integrationsLoading}
					classNames={{ integrations: classNames?.integrations }}
					onAdd={onAddIntegration}
					onRemove={handleRemoveIntegration}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Internal sub-component — category section
// ---------------------------------------------------------------------------

interface CategorySectionProps {
	label: string;
	topics: TopicDefinition[];
	columns: Channel[];
	prefLookup: Map<string, Map<Channel, boolean>>;
	mandatoryLocks: Map<string, Set<Channel>>;
	alwaysEnabled: boolean;
	classNames?: PreferenceCenterClassNames;
	onToggle: (topicKey: string, channel: Channel, enabled: boolean) => void;
	renderRow?: RenderRowFn;
}

function CategorySection({
	label,
	topics,
	columns,
	prefLookup,
	mandatoryLocks,
	alwaysEnabled,
	classNames,
	onToggle,
	renderRow,
}: CategorySectionProps) {
	return (
		<>
			<tr>
				<td
					colSpan={columns.length + 1}
					className={joinClassNames(styles.categoryHeader, classNames?.categoryHeader)}
				>
					{label}
				</td>
			</tr>
			{topics.map((topic) => {
				const topicPrefs = prefLookup.get(topic.topicKey) ?? new Map<Channel, boolean>();
				const locked = mandatoryLocks.get(topic.topicKey) ?? new Set<Channel>();

				if (renderRow) {
					return (
						<tr key={topic.topicKey}>
							<td colSpan={columns.length + 1}>
								{renderRow(topic, topicPrefs, locked, alwaysEnabled)}
							</td>
						</tr>
					);
				}

				return (
					<PreferenceRow
						key={topic.topicKey}
						topic={topic}
						columns={columns}
						preferences={topicPrefs}
						lockedChannels={locked}
						alwaysEnabled={alwaysEnabled}
						classNames={classNames}
						onToggle={onToggle}
					/>
				);
			})}
		</>
	);
}

// ---------------------------------------------------------------------------
// Channel label formatting
// ---------------------------------------------------------------------------

function formatChannelLabel(
	channel: Channel,
	labels: { email: string; push: string; sms: string; inApp: string },
): string {
	switch (channel) {
		case "email":
			return labels.email;
		case "push":
			return labels.push;
		case "sms":
			return labels.sms;
		case "inApp":
			return labels.inApp;
		default:
			return (channel as string).charAt(0).toUpperCase() + (channel as string).slice(1);
	}
}
