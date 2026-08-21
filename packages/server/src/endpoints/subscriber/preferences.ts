import type { Emito, PreferenceRepository } from "@emito/core";
import type { Channel } from "@emito/types";
import { jsonResponse } from "../../response.js";
import type { createRouter } from "../../router.js";
import { preferenceBodySchema } from "../../schemas/subscriber.js";

export function registerSubscriberPreferenceEndpoints(
	router: ReturnType<typeof createRouter>,
	preferenceRepository: PreferenceRepository,
	emito: Emito,
): void {
	// GET /preferences — global preferences merged with system defaults
	router.add({
		method: "GET",
		pathPattern: "/preferences",
		auth: "subscriber",
		async handler(ctx) {
			const explicit = await preferenceRepository.findBySubscriber(ctx.subscriberId, {
				workspaceId: null,
			});

			const explicitKeys = new Set(explicit.map((p) => `${p.topicKey}:${p.channel}`));
			const defaults: Array<{ topicKey: string; channel: Channel; enabled: boolean }> = [];

			for (const eventName of emito.getEventNames()) {
				const event = emito.getEvent(eventName);
				for (const channel of event.channels) {
					if (!explicitKeys.has(`${eventName}:${channel}`)) {
						defaults.push({ topicKey: eventName, channel, enabled: true });
					}
				}
			}

			return jsonResponse({ preferences: [...explicit, ...defaults] });
		},
	});

	// PUT /preferences — upsert global preference
	router.add({
		method: "PUT",
		pathPattern: "/preferences",
		auth: "subscriber",
		schema: { body: preferenceBodySchema },
		async handler(ctx) {
			const preference = await preferenceRepository.upsert({
				subscriberId: ctx.subscriberId,
				workspaceId: null,
				topicKey: ctx.body.topicKey,
				channel: ctx.body.channel,
				enabled: ctx.body.enabled,
			});
			return jsonResponse(preference);
		},
	});

	// POST /preferences/reset — reset global preferences
	router.add({
		method: "POST",
		pathPattern: "/preferences/reset",
		auth: "subscriber",
		async handler(ctx) {
			await preferenceRepository.reset(ctx.subscriberId, null);
			return jsonResponse({ success: true });
		},
	});
}
