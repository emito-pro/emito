import type { ProviderPlugin } from "@emito/types";
import type { DispatchStrategy, StrategyState } from "./types";

const counters = new Map<string, number>();

export function createRoundRobinStrategy(channel: string): DispatchStrategy {
	return {
		name: "round_robin",

		selectProvider(providers: ProviderPlugin[], state: StrategyState): ProviderPlugin | null {
			const available = providers.filter((p) => !state.exhaustedProviders.has(p.name));
			if (available.length === 0) return null;

			const key = `rr:${channel}`;
			const current = counters.get(key) ?? 0;
			const index = current % available.length;
			counters.set(key, current + 1);

			return available[index] ?? null;
		},
	};
}

export function resetRoundRobinCounters(): void {
	counters.clear();
}
