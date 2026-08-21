import type {
	Channel,
	ChannelConfig,
	ChannelDeliveryParams,
	ChannelResult,
	EventDefinition,
	ProviderPlugin,
	SendParams,
	SendResult,
	Subscriber,
} from "@emito/types";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { enforceCategory } from "./categories/enforcement";
import type { CircuitBreaker } from "./circuit-breaker";
import type { DigestEngine } from "./digest/index";
import { dispatch } from "./dispatch/dispatcher";
import type { EventRegistry } from "./event-registry";
import type { EmitoInstanceEvents, TypedEmitter } from "./events";
import type { Logger } from "./observability/logger";
import type { EmitoMetrics } from "./observability/metrics";
import { recordSpanEvent, setSpanError, withSpan } from "./observability/tracing";
import { isChatChannel, routeToIntegrations } from "./preferences/integration-router";
import { resolvePreferences } from "./preferences/resolver";
import type { RateLimitConfig, RateLimiter } from "./rate-limiter";
import type { ConsentRepository } from "./repositories/consent-repository";
import type {
	DeadLetterRepository,
	InboxRepository,
	IntegrationRepository,
	NotificationRepository,
	PreferenceRepository,
	SubscriptionRepository,
	SuppressionRepository,
	WorkspaceDefaultRepository,
} from "./repositories/index";
import type { PushTokenRepository } from "./repositories/push-token-repository";
import type { SubscriberRepository } from "./repositories/subscriber-repository";
import type { IntegrationRecord } from "./repositories/types";
import { resolveSubscriber } from "./subscribers/resolver";
import { checkSuppression } from "./suppression/checker";
import type { TemplateResolver } from "./templates/resolver";
import type { RenderedContent } from "./templates/resolver";

export interface SendDeps {
	eventRegistry: EventRegistry;
	subscriberRepository: SubscriberRepository;
	notificationRepository: NotificationRepository;
	preferenceRepository: PreferenceRepository;
	workspaceDefaultRepository: WorkspaceDefaultRepository;
	suppressionRepository: SuppressionRepository;
	subscriptionRepository: SubscriptionRepository;
	consentRepository: ConsentRepository;
	deadLetterRepository: DeadLetterRepository;
	integrationRepository: IntegrationRepository;
	inboxRepository: InboxRepository;
	pushTokenRepository: PushTokenRepository;
	channelProviders: Map<Channel, ProviderPlugin[]>;
	channelConfigs: Map<Channel, ChannelConfig>;
	templateResolver: TemplateResolver;
	logger: Logger;
	metrics?: EmitoMetrics;
	defaultLang: string;
	defaultLocale?: string;
	defaultTimezone?: string;
	categories?: Record<string, { policy: "always" | "opt_out" | "opt_in" }>;
	rateLimiter?: RateLimiter;
	rateLimitConfigs?: Record<string, RateLimitConfig>;
	circuitBreaker?: CircuitBreaker;
	digestEngine?: DigestEngine;
	emitter?: TypedEmitter<EmitoInstanceEvents>;
}

function generateNotificationId(): string {
	return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getAddressForChannel(subscriber: Subscriber, channel: Channel): string | undefined {
	switch (channel) {
		case "email":
			return subscriber.email ?? undefined;
		case "sms":
		case "whatsapp":
			return subscriber.phone ?? undefined;
		case "push":
		case "webPush":
			return subscriber.pushTokens?.[0];
		case "inApp":
			return subscriber.id;
		case "slack":
		case "telegram":
		case "discord":
		case "webhook":
			return undefined; // handled via integration routing
	}
}

async function buildDeliveryParams(
	channel: Channel,
	subscriber: Subscriber,
	notificationId: string,
	eventType: string,
	rendered: {
		subject?: string;
		body: string;
		html?: string;
		text?: string;
		data?: Record<string, unknown>;
	},
): Promise<ChannelDeliveryParams | undefined> {
	const metadata = { notificationId, subscriberId: subscriber.id, eventType };

	switch (channel) {
		case "email":
			if (!subscriber.email) return undefined;
			return {
				channel: "email",
				to: subscriber.email,
				subject: rendered.subject ?? "",
				html: rendered.html ?? rendered.body,
				text: rendered.text ?? rendered.body,
				metadata,
			};
		case "sms":
			if (!subscriber.phone) return undefined;
			return { channel: "sms", to: subscriber.phone, body: rendered.body, metadata };
		case "push":
			if (!subscriber.pushTokens?.length) return undefined;
			return {
				channel: "push",
				tokens: subscriber.pushTokens,
				title: rendered.subject ?? "",
				body: rendered.body,
				data: rendered.data as Record<string, string> | undefined,
				metadata,
			};
		case "inApp":
			return {
				channel: "inApp",
				subscriberId: subscriber.id,
				title: rendered.subject ?? "",
				body: rendered.body,
				data: rendered.data,
				metadata,
			};
		case "webhook":
			return {
				channel: "webhook",
				url: "",
				payload: rendered.data ?? {},
				metadata,
			};
		case "whatsapp":
			if (!subscriber.phone) return undefined;
			return {
				channel: "whatsapp",
				to: subscriber.phone,
				templateName: "",
				templateParams: {},
				metadata,
			};
		case "webPush":
			return undefined; // requires subscription object
		default:
			return undefined; // chat channels handled via integration routing
	}
}

function buildChatDeliveryParams(
	channel: Channel,
	integration: IntegrationRecord,
	notificationId: string,
	eventType: string,
	subscriberId: string,
	rendered: RenderedContent,
): ChannelDeliveryParams | undefined {
	const metadata = { notificationId, subscriberId, eventType };
	const config = integration.config;

	switch (channel) {
		case "telegram":
			return {
				channel: "telegram",
				botToken: String(config.botToken ?? ""),
				chatId: String(config.chatId ?? ""),
				html: rendered.html ?? rendered.body,
				metadata,
			};
		case "slack":
			return {
				channel: "slack",
				webhookUrl: String(config.webhookUrl ?? ""),
				blocks: (rendered.data?.blocks as unknown[]) ?? [],
				text: rendered.body,
				metadata,
			};
		case "discord":
			return {
				channel: "discord",
				webhookUrl: String(config.webhookUrl ?? ""),
				content: rendered.body,
				metadata,
			};
		default:
			return undefined;
	}
}

export async function executeSend(params: SendParams, deps: SendDeps): Promise<SendResult> {
	const notificationId = generateNotificationId();
	const notifLogger = deps.logger.child({
		notificationId,
		subscriberId: params.subscriberId,
		eventType: params.event,
	});

	return withSpan(
		"emito.send",
		{ notificationId, subscriberId: params.subscriberId, eventType: params.event },
		async (sendSpan) => {
			const channelResults: ChannelResult[] = [];

			// Step 0: Validate payload — the template resolver reads properties off it
			// unconditionally, so an undefined/non-object payload doesn't fail here with
			// a clear message, it throws a bare TypeError deep inside per-channel
			// rendering instead (caught by the Promise.allSettled below and dropped
			// silently from the result, so the caller sees a "successful" send with zero
			// channels). JS callers hit this easily since there's no compiler to catch a
			// missing `payload` the way TS callers would.
			if (
				params.payload === undefined ||
				params.payload === null ||
				typeof params.payload !== "object"
			) {
				const error = new EmitoError({
					code: EMITO_ERROR_CODE.VALIDATION_ERROR,
					message:
						"send() requires `payload` to be an object — pass {} if the event has no template variables",
					isRetryable: false,
				});
				notifLogger.error({ errorCode: error.code, isRetryable: false }, "invalid payload");
				setSpanError(sendSpan, error.code, error.message);
				throw error;
			}

			// Step 1: Validate event exists in registry
			let eventDef: EventDefinition;
			try {
				eventDef = deps.eventRegistry.getEvent(params.event);
			} catch (error) {
				notifLogger.error(
					{ errorCode: (error as EmitoError).code, isRetryable: false },
					"unknown event",
				);
				setSpanError(sendSpan, EMITO_ERROR_CODE.CONFIG_INVALID, `Unknown event: ${params.event}`);
				throw error;
			}

			// Step 2: Resolve subscriber
			let subscriber: Subscriber;
			try {
				const resolved = await resolveSubscriber(params.subscriberId, params.recipient, {
					subscriberRepository: deps.subscriberRepository,
				});
				subscriber = resolved.subscriber;
			} catch (error) {
				notifLogger.error(
					{ errorCode: (error as EmitoError).code, isRetryable: false },
					"subscriber resolution failed",
				);
				setSpanError(sendSpan, (error as EmitoError).code, (error as EmitoError).message);
				throw error;
			}

			// Step 3: Check category / enforce consent
			const categoryKey = eventDef.category;
			const topicKey = params.event; // event name as topic key
			const actualCategory = deps.categories?.[categoryKey] ?? { policy: "opt_out" as const };

			await enforceCategory(subscriber, actualCategory, categoryKey, topicKey, {
				subscriptionRepository: deps.subscriptionRepository,
				consentRepository: deps.consentRepository,
			});

			// Step 4-7: Process each channel concurrently
			const channelPromises = eventDef.channels.map(async (channel) => {
				return withSpan(
					`emito.deliver.${channel}`,
					{ notificationId, subscriberId: params.subscriberId, channel },
					async (deliverSpan) => {
						const deliveryLogger = notifLogger.child({ channel });
						const start = performance.now();

						// Step 4: Check suppression for this channel
						const address = getAddressForChannel(subscriber, channel);
						if (address && !isChatChannel(channel)) {
							const suppResult = await checkSuppression(deps.suppressionRepository, {
								address,
								channel,
							});
							if (suppResult.suppressed) {
								deliveryLogger.info({ status: "suppressed" }, "delivery suppressed");
								recordSpanEvent(deliverSpan, "suppressed");
								deps.metrics?.notificationsSentTotal.inc({
									channel,
									provider: "none",
									status: "rejected",
								});
								return { channel, status: "suppressed" as const };
							}
						}

						// Step 5: Resolve preferences
						const prefResult = await resolvePreferences({
							subscriberId: params.subscriberId,
							workspaceId: params.workspaceId,
							topicKey,
							channel,
							eventDefinition: eventDef,
							preferenceRepository: deps.preferenceRepository,
							workspaceDefaultRepository: deps.workspaceDefaultRepository,
						});

						if (!prefResult.enabled) {
							deliveryLogger.info(
								{ status: "blocked_by_preference", tier: prefResult.tier },
								"channel blocked by preference",
							);
							recordSpanEvent(deliverSpan, "preference_blocked", { tier: prefResult.tier });
							const blockStatus =
								prefResult.tier === "workspace_admin_block"
									? "blocked_by_admin"
									: "blocked_by_preference";
							return { channel, status: blockStatus as ChannelResult["status"] };
						}

						// Step 5b: Rate limit check
						if (deps.rateLimiter && deps.rateLimitConfigs?.[channel]) {
							const rlResult = await deps.rateLimiter.checkAndRecord(
								channel,
								params.subscriberId,
								deps.rateLimitConfigs[channel],
							);
							if (!rlResult.allowed) {
								deliveryLogger.info(
									{ status: "rate_limited", remaining: 0 },
									"delivery rate limited",
								);
								recordSpanEvent(deliverSpan, "rate_limited");
								return { channel, status: "rate_limited" as const };
							}
						}

						// Step 6b: Digest check
						if (deps.digestEngine && eventDef.digest) {
							const digestChannels = eventDef.digest.channels ?? eventDef.channels;
							if (digestChannels.includes(channel)) {
								const thresholdReached = await deps.digestEngine.addEvent({
									subscriberId: params.subscriberId,
									eventType: params.event,
									payload: params.payload,
									timestamp: Date.now(),
								});

								if (!thresholdReached) {
									deliveryLogger.info({ status: "digested" }, "event buffered for digest");
									recordSpanEvent(deliverSpan, "digested");
									return { channel, status: "digested" as const };
								}

								/* Threshold reached — flush all buffered events.
								   The current event is already in the buffer from addEvent().
								   Flush returns all events; we continue with normal dispatch
								   using the original params (the digest consumer will handle
								   the batched payload). */
								const flushedEvents = await deps.digestEngine.flush(
									params.subscriberId,
									params.event,
								);
								deliveryLogger.info(
									{ flushed: flushedEvents.length },
									"digest threshold reached, flushing",
								);
								recordSpanEvent(deliverSpan, "digest_flushed", {
									count: String(flushedEvents.length),
								});
							}
						}

						// Step 6a: Resolve template
						const lang = params.lang ?? subscriber.lang ?? deps.defaultLang;
						const locale = params.locale ?? subscriber.locale ?? deps.defaultLocale;
						const timezone = params.timezone ?? subscriber.timezone ?? deps.defaultTimezone;
						const rendered = await deps.templateResolver.resolve({
							event: params.event,
							channel,
							lang,
							locale,
							timezone,
							payload: params.payload,
						});

						// Step 6b: Handle inApp channel — write to inbox
						if (channel === "inApp") {
							try {
								const inboxRecord = await deps.inboxRepository.create({
									subscriberId: params.subscriberId,
									workspaceId: params.workspaceId,
									eventType: params.event,
									category: categoryKey,
									topicKey,
									subject: rendered.subject,
									body: rendered.body,
									data: rendered.data ?? {},
								});

								deps.emitter?.emit("notification:created", params.subscriberId, {
									notificationId,
									subscriberId: params.subscriberId,
									event: params.event,
									category: inboxRecord.category,
									topic: inboxRecord.topicKey,
									subject: inboxRecord.subject,
									body: inboxRecord.body,
									avatar: inboxRecord.avatar,
									actionUrl: inboxRecord.actionUrl,
									primaryAction:
										inboxRecord.primaryActionLabel && inboxRecord.primaryActionUrl
											? {
													label: inboxRecord.primaryActionLabel,
													url: inboxRecord.primaryActionUrl,
												}
											: undefined,
									secondaryAction:
										inboxRecord.secondaryActionLabel && inboxRecord.secondaryActionUrl
											? {
													label: inboxRecord.secondaryActionLabel,
													url: inboxRecord.secondaryActionUrl,
												}
											: undefined,
									data: inboxRecord.data,
									timestamp: new Date(),
								});

								const duration = Math.round(performance.now() - start);
								deliveryLogger.info({ status: "sent", duration }, "inbox notification created");
								deps.metrics?.notificationsSentTotal.inc({
									channel,
									provider: "inbox",
									status: "sent",
								});
								deps.metrics?.deliveryDurationMs.observe({ channel, provider: "inbox" }, duration);
								return { channel, status: "sent" as const, provider: "inbox" };
							} catch (error) {
								const duration = Math.round(performance.now() - start);
								deliveryLogger.error(
									{ errorCode: "DELIVERY_FAILED", isRetryable: false, duration },
									"inbox creation failed",
								);
								deps.metrics?.providerErrorsTotal.inc({
									channel,
									provider: "inbox",
									error_code: "DELIVERY_FAILED",
								});
								return { channel, status: "failed" as const, error: String(error) };
							}
						}

						// Step 6c: Handle chat channels via integration routing
						if (isChatChannel(channel) && params.workspaceId) {
							const integrationResults = await routeToIntegrations({
								subscriberId: params.subscriberId,
								workspaceId: params.workspaceId,
								eventType: params.event,
								channel,
								deliver: async (integration) => {
									const provider = deps.channelProviders.get(channel)?.[0];
									if (!provider) throw new Error(`No provider for channel ${channel}`);

									const chatParams = buildChatDeliveryParams(
										channel,
										integration,
										notificationId,
										params.event,
										params.subscriberId,
										rendered,
									);
									if (!chatParams) throw new Error(`Cannot build delivery params for ${channel}`);

									return provider.deliver(chatParams);
								},
								integrationRepository: deps.integrationRepository,
							});

							if (integrationResults.length === 0) {
								deliveryLogger.warn(
									{ status: "no_provider" },
									"no integrations found for chat channel",
								);
								return { channel, status: "no_provider" as const };
							}

							const anySuccess = integrationResults.some((r) => r.status === "fulfilled");
							const duration = Math.round(performance.now() - start);
							const status = anySuccess ? "sent" : "failed";
							deliveryLogger.info(
								{ status, duration, integrations: integrationResults.length },
								"chat delivery completed",
							);
							deps.metrics?.notificationsSentTotal.inc({
								channel,
								provider: "integration",
								status,
							});
							deps.metrics?.deliveryDurationMs.observe(
								{ channel, provider: "integration" },
								duration,
							);
							return { channel, status: status as ChannelResult["status"] };
						}

						// Step 6d: Get providers for this channel
						const providers = deps.channelProviders.get(channel);
						if (!providers || providers.length === 0) {
							deliveryLogger.warn({ status: "no_provider" }, "no providers configured for channel");
							return { channel, status: "no_provider" as const };
						}

						// Step 6e: Build delivery params
						// A fresh id per channel here, NOT the shared `notificationId` — every
						// channel that reaches this point (email, sms, push, ...) writes its own
						// row to `notificationRepository`, and `id` is that table's sole primary
						// key. Reusing `notificationId` across channels of the same send() call
						// means the second channel's insert always hits a duplicate-key error,
						// silently dropping that channel's delivery. `metadata.notificationId`
						// (set below) must equal this row's actual id — `dispatch()` reads it
						// back out of `deliveryParams.metadata` to call `updateStatus(id, ...)`
						// on completion, and `/track/open/:id`+`/track/click/:id` resolve it via
						// `findById` — a mismatch there would silently break both.
						const channelNotificationId = generateNotificationId();
						const deliveryParams = await buildDeliveryParams(
							channel,
							subscriber,
							channelNotificationId,
							params.event,
							rendered,
						);

						if (!deliveryParams) {
							deliveryLogger.warn(
								{ status: "no_provider" },
								"cannot build delivery params - missing subscriber contact info",
							);
							return { channel, status: "no_provider" as const };
						}

						// Step 6f: Create notification record
						await deps.notificationRepository.create({
							id: channelNotificationId,
							subscriberId: params.subscriberId,
							workspaceId: params.workspaceId,
							eventType: params.event,
							category: categoryKey,
							channel,
							status: "pending",
							deliveryAddress:
								"to" in deliveryParams && typeof deliveryParams.to === "string"
									? deliveryParams.to
									: undefined,
							payload: params.payload,
							idempotencyKey: params.idempotencyKey,
						});

						// Step 6g: Dispatch via provider pipeline
						const channelConfig = deps.channelConfigs.get(channel);
						const dispatchResult = await dispatch({
							providers,
							strategy: channelConfig?.strategy ?? "priority",
							deliveryParams,
							retryPolicy: channelConfig?.retry,
							weights: channelConfig?.weights,
							notificationRepository: deps.notificationRepository,
							suppressionRepository: deps.suppressionRepository,
							deadLetterRepository: deps.deadLetterRepository,
							pushTokenRepository: deps.pushTokenRepository,
							logger: deliveryLogger,
							circuitBreaker: deps.circuitBreaker,
						});

						const duration = Math.round(performance.now() - start);

						if (dispatchResult.success) {
							deliveryLogger.info(
								{ provider: dispatchResult.provider, duration, status: "sent" },
								"delivery succeeded",
							);
							deps.metrics?.notificationsSentTotal.inc({
								channel,
								provider: dispatchResult.provider ?? "unknown",
								status: "sent",
							});
							deps.metrics?.deliveryDurationMs.observe(
								{ channel, provider: dispatchResult.provider ?? "unknown" },
								duration,
							);
							return {
								channel,
								status: "sent" as const,
								provider: dispatchResult.provider,
								providerMessageId: dispatchResult.providerMessageId,
							};
						}

						if (dispatchResult.suppressed) {
							deliveryLogger.info(
								{ status: "suppressed", duration },
								"delivery suppressed by dispatch",
							);
							deps.metrics?.notificationsSentTotal.inc({
								channel,
								provider: "none",
								status: "rejected",
							});
							return { channel, status: "suppressed" as const };
						}

						// Failed
						deliveryLogger.error(
							{
								errorCode: dispatchResult.errorCode,
								isRetryable: !dispatchResult.permanent,
								duration,
							},
							"delivery failed",
						);
						deps.metrics?.providerErrorsTotal.inc({
							channel,
							provider: dispatchResult.provider ?? "unknown",
							error_code: dispatchResult.errorCode ?? "DELIVERY_FAILED",
						});
						deps.metrics?.notificationsSentTotal.inc({
							channel,
							provider: dispatchResult.provider ?? "unknown",
							status: "failed",
						});

						const errorClassification = dispatchResult.permanent
							? ("permanent" as const)
							: dispatchResult.exhausted
								? ("transient" as const)
								: undefined;

						return {
							channel,
							status: "failed" as const,
							provider: dispatchResult.provider,
							error: dispatchResult.errorMessage,
							errorClassification,
						};
					},
				);
			});

			const results = await Promise.allSettled(channelPromises);

			for (const result of results) {
				if (result.status === "fulfilled") {
					channelResults.push(result.value);
				} else {
					notifLogger.error(
						{ error: String(result.reason) },
						"channel delivery threw unexpectedly",
					);
				}
			}

			notifLogger.info({ notificationId, channelCount: channelResults.length }, "send completed");
			return { notificationId, channels: channelResults };
		},
	);
}
