import type { Channel } from "./channels";

export interface CategoryDefinition {
	policy: "always" | "opt_out" | "opt_in";
	topics?: Record<string, { channels?: Channel[]; description?: string }>;
}

export type EmitoCategories = Record<string, CategoryDefinition>;

export interface EventDefinition<TCategory extends string = string> {
	category: TCategory;
	channels: Channel[];
	priority?: "critical" | "high" | "low";
	description?: string;
	bypassPreferences?: boolean;
	bypassRateLimit?: boolean;
	digest?: { windowMs: number; maxCount: number; channels?: Channel[] };
}

export type EmitoEvents<TCategory extends string = string> = Record<
	string,
	EventDefinition<TCategory>
>;
