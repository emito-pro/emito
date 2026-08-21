import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { Channel, ChannelDeliveryParams, DeliveryResult, ProviderPlugin } from "@emito/types";
import { type DeliveryErrorContext, deliveryErrorContext } from "./errors";

/**
 * Narrows the `ChannelDeliveryParams` union down to the params of one channel.
 *
 * This is what lets a provider's `deliver` receive `EmailDeliveryParams`
 * directly instead of casting the union on the first line of every
 * implementation.
 */
export type DeliveryParamsFor<C extends Channel> = Extract<ChannelDeliveryParams, { channel: C }>;

/**
 * The slice of a validation library this kit depends on.
 *
 * Structural on purpose: a Zod schema satisfies it without the kit taking a
 * dependency on Zod, so a provider is free to validate with something else.
 */
export interface ConfigSchema<T> {
	safeParse(input: unknown): ConfigParseResult<T>;
}

export type ConfigParseResult<T> =
	| { success: true; data: T }
	| {
			success: false;
			error: { message: string; flatten(): { fieldErrors: unknown } };
	  };

export interface ProviderDefinition<C extends Channel, Cfg, Ctx> {
	/** Stable machine name, e.g. "resend". Surfaces in error context and routing. */
	name: string;
	channel: C;
	/** Name used in human-facing messages, e.g. "SMSAPI". Defaults to `name`. */
	displayName?: string;
	/** When present, config is validated before `setup` runs; failures throw CONFIG_INVALID. */
	configSchema?: ConfigSchema<Cfg>;
	/** Builds whatever `deliver` needs — an SDK client, a resolved fetch, endpoints. Runs once. */
	setup: (config: Cfg) => Ctx;
	deliver: (
		params: DeliveryParamsFor<C>,
		ctx: Ctx,
		errorContext: DeliveryErrorContext,
	) => Promise<DeliveryResult>;
	/** Defaults to reporting healthy — `setup` throwing is what signals a broken provider. */
	healthCheck?: (ctx: Ctx) => boolean | Promise<boolean>;
	/**
	 * Classifies an SDK-thrown error. Return `undefined` to fall through to the
	 * default (`PROVIDER_UNAVAILABLE`, retryable). `EmitoError`s thrown from
	 * `deliver` bypass this and propagate untouched.
	 */
	mapError?: (err: unknown, errorContext: DeliveryErrorContext) => EmitoError | undefined;
}

function parseConfig<Cfg>(
	schema: ConfigSchema<Cfg>,
	config: Cfg,
	name: string,
	displayName: string,
): Cfg {
	const parsed = schema.safeParse(config);
	if (parsed.success) return parsed.data;

	throw new EmitoError({
		code: EMITO_ERROR_CODE.CONFIG_INVALID,
		message: `Invalid ${displayName} provider config: ${parsed.error.message}`,
		context: { provider: name, errors: parsed.error.flatten().fieldErrors },
	});
}

/**
 * Builds a provider factory from a definition, taking care of the parts every
 * provider repeats: config validation, error-context construction, narrowing
 * the delivery params to the channel, and the terminal catch that guarantees a
 * caller only ever sees an `EmitoError`.
 *
 * The returned plugin satisfies the plain `ProviderPlugin` contract from
 * `@emito/types` — this kit is a convenience, not a requirement, and a provider
 * written by hand against that interface stays a first-class citizen.
 */
export function defineProvider<C extends Channel, Cfg, Ctx>(
	definition: ProviderDefinition<C, Cfg, Ctx>,
): (config: Cfg) => ProviderPlugin {
	const { name, channel, configSchema, setup, deliver, healthCheck, mapError } = definition;
	const displayName = definition.displayName ?? name;

	return (config: Cfg): ProviderPlugin => {
		const validated = configSchema ? parseConfig(configSchema, config, name, displayName) : config;
		const ctx = setup(validated);

		return {
			name,
			channel,

			async deliver(params: ChannelDeliveryParams): Promise<DeliveryResult> {
				const typedParams = params as DeliveryParamsFor<C>;
				const errorContext = deliveryErrorContext(name, channel, typedParams.metadata);

				try {
					return await deliver(typedParams, ctx, errorContext);
				} catch (err: unknown) {
					if (err instanceof EmitoError) throw err;

					const mapped = mapError?.(err, errorContext);
					if (mapped) throw mapped;

					throw EmitoError.fromUnknown(err, {
						code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE,
						context: errorContext,
					});
				}
			},

			async healthCheck(): Promise<boolean> {
				return healthCheck ? healthCheck(ctx) : true;
			},
		};
	};
}
