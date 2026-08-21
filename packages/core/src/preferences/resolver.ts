import type {
	Channel,
	EventDefinition,
	PreferenceResolutionResult,
	PreferenceTier,
} from "@emito/types";
import type { PreferenceRepository } from "../repositories/preference-repository";
import type { WorkspaceDefaultRepository } from "../repositories/workspace-default-repository";

export interface ResolvePreferencesParams {
	subscriberId: string;
	workspaceId?: string;
	topicKey: string;
	channel: Channel;
	eventDefinition: EventDefinition;
	preferenceRepository: PreferenceRepository;
	workspaceDefaultRepository: WorkspaceDefaultRepository;
}

/**
 * Resolves a channel preference for a subscriber using the 5-tier algorithm.
 *
 * Tier 1: Workspace admin mandatory override (isMandatory=true) — user cannot override
 *         This covers both hard-block (enabled=false) and force-enable (enabled=true)
 * Tier 2: User's workspace-scoped preference
 * Tier 3: Workspace admin default (non-mandatory)
 * Tier 4: User's global preference (workspace_id IS NULL)
 * Tier 5: System default (channel is in event definition = enabled)
 *
 * When eventDefinition.bypassPreferences is true, all tiers are skipped and the
 * channel is enabled if it appears in the event's channels list.
 */
export async function resolvePreferences(
	params: ResolvePreferencesParams,
): Promise<PreferenceResolutionResult> {
	const {
		subscriberId,
		workspaceId,
		topicKey,
		channel,
		eventDefinition,
		preferenceRepository,
		workspaceDefaultRepository,
	} = params;

	const isInEventChannels = eventDefinition.channels.includes(channel);

	// bypassPreferences skips all preference tiers
	if (eventDefinition.bypassPreferences) {
		return {
			enabled: isInEventChannels,
			tier: "system_default" as PreferenceTier,
		};
	}

	// Fetch all data upfront to avoid N+1 queries
	const [workspaceDefaults, workspacePreferences, globalPreferences] = await Promise.all([
		workspaceId
			? workspaceDefaultRepository.findByWorkspace(workspaceId, topicKey)
			: Promise.resolve([]),
		workspaceId
			? preferenceRepository.findBySubscriber(subscriberId, {
					workspaceId,
					topicKey,
				})
			: Promise.resolve([]),
		preferenceRepository.findBySubscriber(subscriberId, {
			workspaceId: null,
			topicKey,
		}),
	]);

	// Tier 1: Workspace admin mandatory override (user cannot override)
	const mandatoryOverride = workspaceDefaults.find(
		(d) => (d.channel === channel || d.channel === undefined) && d.isMandatory,
	);
	if (mandatoryOverride) {
		return {
			enabled: mandatoryOverride.enabled,
			tier: "workspace_admin_block" as PreferenceTier,
		};
	}

	// Tier 2: User's workspace-scoped preference
	const workspacePref = workspacePreferences.find(
		(p) => p.channel === channel || p.channel === undefined,
	);
	if (workspacePref) {
		return {
			enabled: workspacePref.enabled,
			tier: "user_workspace" as PreferenceTier,
		};
	}

	// Tier 3: Workspace admin default (non-mandatory)
	const workspaceDefault = workspaceDefaults.find(
		(d) => (d.channel === channel || d.channel === undefined) && !d.isMandatory,
	);
	if (workspaceDefault) {
		return {
			enabled: workspaceDefault.enabled,
			tier: "workspace_default" as PreferenceTier,
		};
	}

	// Tier 4: User's global preference
	const globalPref = globalPreferences.find(
		(p) => p.channel === channel || p.channel === undefined,
	);
	if (globalPref) {
		return {
			enabled: globalPref.enabled,
			tier: "user_global" as PreferenceTier,
		};
	}

	// Tier 5: System default — enabled if channel is in event definition
	return {
		enabled: isInEventChannels,
		tier: "system_default" as PreferenceTier,
	};
}
