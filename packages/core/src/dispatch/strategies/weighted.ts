import type { ProviderPlugin } from "@emito/types";
import type { DispatchStrategy, StrategyState } from "./types";

export function createWeightedStrategy(weights: number[]): DispatchStrategy {
	return {
		name: "weighted",

		selectProvider(providers: ProviderPlugin[], state: StrategyState): ProviderPlugin | null {
			const available: Array<{ provider: ProviderPlugin; weight: number }> = [];

			for (let i = 0; i < providers.length; i++) {
				const provider = providers[i];
				if (provider && !state.exhaustedProviders.has(provider.name)) {
					available.push({
						provider,
						weight: weights[i] ?? 1,
					});
				}
			}

			if (available.length === 0) return null;

			const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
			const random = Math.random() * totalWeight;

			let cumulative = 0;
			for (const entry of available) {
				cumulative += entry.weight;
				if (random < cumulative) {
					return entry.provider;
				}
			}

			const last = available[available.length - 1];
			return last ? last.provider : null;
		},
	};
}
