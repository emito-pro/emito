import type { Channel } from "@emito/types";
import type { IntegrationRepository } from "../repositories/integration-repository";
import type { IntegrationRecord } from "../repositories/types";

/** Chat channels that use integration-based routing */
const CHAT_CHANNELS: ReadonlySet<string> = new Set(["slack", "telegram", "discord"]);

export interface IntegrationDeliveryResult {
	integrationId: string;
	status: "fulfilled" | "rejected";
	value?: unknown;
	reason?: unknown;
}

export interface RouteToIntegrationsParams {
	subscriberId: string;
	workspaceId: string;
	eventType: string;
	channel: Channel;
	deliver: (integration: IntegrationRecord) => Promise<unknown>;
	integrationRepository: IntegrationRepository;
}

/**
 * Returns true if the channel uses integration-based routing.
 */
export function isChatChannel(channel: Channel): boolean {
	return CHAT_CHANNELS.has(channel);
}

/**
 * Finds all matching integrations for a chat channel delivery and delivers
 * to ALL of them concurrently via Promise.allSettled.
 *
 * Queries for workspace-wide integrations (subscriberId=undefined) and
 * subscriber-specific integrations, filtered by event type matching.
 *
 * Returns an array of results, one per integration, indicating success or failure.
 * Never throws — partial failures are captured in the result array.
 */
export async function routeToIntegrations(
	params: RouteToIntegrationsParams,
): Promise<IntegrationDeliveryResult[]> {
	const { subscriberId, workspaceId, eventType, channel, deliver, integrationRepository } = params;

	const integrations = await integrationRepository.findForRouting({
		workspaceId,
		subscriberId,
		channel,
		eventType,
	});

	if (integrations.length === 0) {
		return [];
	}

	const settled = await Promise.allSettled(integrations.map((integration) => deliver(integration)));

	return settled.map((result, index) => {
		const integration = integrations[index];
		const integrationId = integration ? integration.id : `unknown_${index}`;
		if (result.status === "fulfilled") {
			return {
				integrationId,
				status: "fulfilled" as const,
				value: result.value,
			};
		}
		return {
			integrationId,
			status: "rejected" as const,
			reason: result.reason,
		};
	});
}
