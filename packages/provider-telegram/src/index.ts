import {
	defineProvider,
	deliveryError,
	httpDeliveryError,
	providerFetch,
	readErrorBody,
} from "@emito/provider-kit";
import type { FetchOptions } from "@emito/provider-kit";
import { EMITO_ERROR_CODE } from "@emito/types";
import type { ProviderPlugin } from "@emito/types";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramProviderOptions extends FetchOptions {}

/** An unknown chat is a bad destination, not a generic rejection. */
const TELEGRAM_STATUS_OVERRIDES = {
	404: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS,
} as const;

const create = defineProvider<"telegram", TelegramProviderOptions, TelegramProviderOptions>({
	name: "telegram",
	displayName: "Telegram",
	channel: "telegram",

	setup: (options) => options,

	deliver: async (params, options, errorContext) => {
		const response = await providerFetch(
			`${TELEGRAM_API_BASE}/bot${params.botToken}/sendMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: params.chatId,
					text: params.html,
					parse_mode: "HTML",
				}),
			},
			{ displayName: "Telegram", context: errorContext, ...options },
		);

		if (!response.ok) {
			const body = await readErrorBody(response);

			// A user who blocked the bot has withdrawn consent — suppressable, not retryable.
			if (response.status === 403 && body.toLowerCase().includes("blocked by the user")) {
				throw deliveryError(
					EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT,
					`Telegram bot blocked by user: ${body}`,
					{ context: errorContext },
				);
			}

			throw httpDeliveryError({
				displayName: "Telegram",
				status: response.status,
				detail: body,
				context: errorContext,
				overrides: TELEGRAM_STATUS_OVERRIDES,
			});
		}

		return { success: true };
	},
});

export function createTelegramProvider(options: TelegramProviderOptions = {}): ProviderPlugin {
	return create(options);
}
