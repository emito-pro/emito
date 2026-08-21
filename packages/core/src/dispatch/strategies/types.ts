import type { ProviderPlugin } from "@emito/types";

export interface StrategyState {
	exhaustedProviders: Set<string>;
}

export interface DispatchStrategy {
	name: string;
	selectProvider(providers: ProviderPlugin[], state: StrategyState): ProviderPlugin | null;
}
