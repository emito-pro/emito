import type { ProviderPlugin } from "@emito/types";
import type { DispatchStrategy, StrategyState } from "./types";

export function createPriorityStrategy(): DispatchStrategy {
	return {
		name: "priority",

		selectProvider(providers: ProviderPlugin[], state: StrategyState): ProviderPlugin | null {
			for (const provider of providers) {
				if (!state.exhaustedProviders.has(provider.name)) {
					return provider;
				}
			}
			return null;
		},
	};
}
