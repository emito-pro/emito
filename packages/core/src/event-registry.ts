import { EMITO_ERROR_CODE, EmitoError, type EventDefinition } from "@emito/types";

export interface EventRegistry<TEvent extends string = string> {
	getEvent(name: TEvent): EventDefinition;
	hasEvent(name: string): boolean;
	getEventNames(): TEvent[];
}

export function createEventRegistry<TEvent extends string = string>(
	events: Record<TEvent, EventDefinition>,
): EventRegistry<TEvent> {
	const eventMap = new Map<string, EventDefinition>();

	for (const [name, definition] of Object.entries<EventDefinition>(events)) {
		eventMap.set(name, definition);
	}

	return {
		getEvent(name: TEvent): EventDefinition {
			const event = eventMap.get(name);
			if (!event) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.CONFIG_INVALID,
					message: `Unknown event: ${name}`,
					isRetryable: false,
					context: { eventName: name },
				});
			}
			return event;
		},

		hasEvent(name: string): boolean {
			return eventMap.has(name);
		},

		getEventNames(): TEvent[] {
			return [...eventMap.keys()] as TEvent[];
		},
	};
}
