import {
	defineProvider,
	httpDeliveryError,
	providerFetch,
	readErrorBody,
} from "@emito/provider-kit";
import type { FetchOptions } from "@emito/provider-kit";
import { EMITO_ERROR_CODE } from "@emito/types";
import type { ProviderPlugin } from "@emito/types";

export interface SlackProviderOptions extends FetchOptions {}

/** A missing webhook is a bad destination, not a generic rejection. */
const SLACK_STATUS_OVERRIDES = {
	404: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS,
} as const;

const create = defineProvider<"slack", SlackProviderOptions, SlackProviderOptions>({
	name: "slack",
	displayName: "Slack",
	channel: "slack",

	setup: (options) => options,

	deliver: async (params, options, errorContext) => {
		const response = await providerFetch(
			params.webhookUrl,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					blocks: params.blocks,
					text: params.text,
				}),
			},
			{ displayName: "Slack", context: errorContext, ...options },
		);

		if (!response.ok) {
			throw httpDeliveryError({
				displayName: "Slack",
				status: response.status,
				detail: await readErrorBody(response),
				context: errorContext,
				overrides: SLACK_STATUS_OVERRIDES,
			});
		}

		return { success: true };
	},
});

export function createSlackProvider(options: SlackProviderOptions = {}): ProviderPlugin {
	return create(options);
}
