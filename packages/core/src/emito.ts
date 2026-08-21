import type {
	Channel,
	ChannelConfig,
	EmitoConfig,
	EventDefinition,
	ProviderPlugin,
	SendParams,
	SendResult,
} from "@emito/types";
import { EMITO_ERROR_CODE, EmitoConfigSchema, EmitoError } from "@emito/types";
import { createBroadcastScheduler } from "./broadcast/scheduler";
import type { BroadcastScheduler } from "./broadcast/scheduler";
import { BroadcastService } from "./broadcast/service";
import { createCircuitBreaker } from "./circuit-breaker";
import type { CircuitBreaker } from "./circuit-breaker";
import { createDigestEngine } from "./digest/index";
import type { DigestEngine } from "./digest/index";
import { createEventRegistry } from "./event-registry";
import type { EventRegistry } from "./event-registry";
import { type EmitoInstanceEvents, type TypedEmitter, createTypedEmitter } from "./events";
import {
	type HealthCheckResult,
	healthCheck as doHealthCheck,
	start as doStart,
	stop as doStop,
} from "./lifecycle";
import { resolveLogger } from "./observability/logger";
import type { Logger } from "./observability/logger";
import { type EmitoMetrics, createMetrics } from "./observability/metrics";
import { DEFAULT_RATE_LIMITS, createRateLimiter } from "./rate-limiter";
import type { RedisLike } from "./redis/types";
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
import type { ListMemberRepository } from "./repositories/list-member-repository";
import type { ListRepository } from "./repositories/list-repository";
import type { PushTokenRepository } from "./repositories/push-token-repository";
import type { SubscriberRepository } from "./repositories/subscriber-repository";
import { executeSend } from "./send";
import { createPassthroughResolver } from "./templates/resolver";
import type { TemplateResolver } from "./templates/resolver";

export interface EmitoCoreConfig extends EmitoConfig {
	logger?: Logger;
	redisClient?: RedisLike;
	/** Unique instance identifier for per-instance digest checkpoint isolation in multi-instance deployments. */
	instanceId?: string;
	repositories: {
		subscriberRepository: SubscriberRepository;
		notificationRepository: NotificationRepository;
		preferenceRepository: PreferenceRepository;
		workspaceDefaultRepository: WorkspaceDefaultRepository;
		suppressionRepository: SuppressionRepository;
		subscriptionRepository: SubscriptionRepository;
		deadLetterRepository: DeadLetterRepository;
		integrationRepository: IntegrationRepository;
		inboxRepository: InboxRepository;
		pushTokenRepository: PushTokenRepository;
		consentRepository: ConsentRepository;
		listRepository?: ListRepository;
		listMemberRepository?: ListMemberRepository;
	};
	templateResolver?: TemplateResolver;
}

export interface Emito {
	send(params: SendParams): Promise<SendResult>;
	start(): Promise<void>;
	stop(): Promise<void>;
	healthCheck(): Promise<HealthCheckResult>;
	on<K extends keyof EmitoInstanceEvents & string>(event: K, handler: EmitoInstanceEvents[K]): void;
	off<K extends keyof EmitoInstanceEvents & string>(
		event: K,
		handler: EmitoInstanceEvents[K],
	): void;
	getEventNames(): string[];
	getEvent(name: string): EventDefinition;
	readonly broadcastService?: BroadcastService;
	readonly broadcastScheduler?: BroadcastScheduler;
}

/**
 * Creates an Emito instance from configuration.
 * Validates config with Zod, resolves dependencies, and returns the API surface.
 */
export function createEmito(config: EmitoCoreConfig): Emito {
	// Validate base config with Zod
	const parseResult = EmitoConfigSchema.safeParse(config);
	if (!parseResult.success) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.CONFIG_INVALID,
			message: `Invalid configuration: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
			isRetryable: false,
			context: { issues: parseResult.error.issues },
		});
	}

	// Validate that all events reference valid categories
	if (config.events && config.categories) {
		const categoryNames = new Set(Object.keys(config.categories));
		for (const [eventName, eventDef] of Object.entries(config.events)) {
			if (!categoryNames.has(eventDef.category)) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.CONFIG_INVALID,
					message: `Event "${eventName}" references unknown category "${eventDef.category}"`,
					isRetryable: false,
					context: { eventName, category: eventDef.category },
				});
			}
		}
	}

	const logger = resolveLogger(config.logger);
	const metrics = createMetrics({
		enabled: config.observability?.metrics?.enabled ?? false,
		prefix: config.observability?.metrics?.prefix,
	});
	const templateResolver = config.templateResolver ?? createPassthroughResolver();
	const emitter: TypedEmitter<EmitoInstanceEvents> = createTypedEmitter<EmitoInstanceEvents>({
		onListenerError: (event, error) => logger.error({ event, err: error }, "listener threw"),
	});

	// Build event registry
	const eventRegistry: EventRegistry = createEventRegistry(config.events ?? {});

	// Collect all providers from channel configs
	const channelProviders = new Map<Channel, ProviderPlugin[]>();
	const channelConfigs = new Map<Channel, ChannelConfig>();
	const allProviders: ProviderPlugin[] = [];

	if (config.channels) {
		for (const [channel, channelConfig] of Object.entries(config.channels)) {
			if (!channelConfig) continue;
			const ch = channel as Channel;
			const providers = channelConfig.providers as ProviderPlugin[];
			channelProviders.set(ch, providers);
			channelConfigs.set(ch, channelConfig);
			allProviders.push(...providers);
		}
	}

	const repos = config.repositories;
	const defaultLang = config.defaultLang ?? "en";
	const defaultLocale = config.defaultLocale;
	const defaultTimezone = config.defaultTimezone;

	// Create rate limiter if Redis is available
	const rateLimiter = config.redisClient
		? createRateLimiter({ redis: config.redisClient, logger, metrics })
		: undefined;

	// Create circuit breaker if Redis is available
	const circuitBreaker: CircuitBreaker | undefined = config.redisClient
		? createCircuitBreaker({ redis: config.redisClient, logger, metrics })
		: undefined;

	// Create digest engine if Redis is available
	const digestEngine: DigestEngine | undefined = config.redisClient
		? createDigestEngine({
				redis: config.redisClient,
				logger,
				metrics,
				config: { maxCount: 50, windowMs: 60_000, instanceId: config.instanceId },
			})
		: undefined;

	const sendDeps = {
		eventRegistry,
		categories: config.categories,
		subscriberRepository: repos.subscriberRepository,
		notificationRepository: repos.notificationRepository,
		preferenceRepository: repos.preferenceRepository,
		workspaceDefaultRepository: repos.workspaceDefaultRepository,
		suppressionRepository: repos.suppressionRepository,
		subscriptionRepository: repos.subscriptionRepository,
		consentRepository: repos.consentRepository,
		deadLetterRepository: repos.deadLetterRepository,
		integrationRepository: repos.integrationRepository,
		inboxRepository: repos.inboxRepository,
		pushTokenRepository: repos.pushTokenRepository,
		channelProviders,
		channelConfigs,
		templateResolver,
		logger,
		metrics,
		defaultLang,
		defaultLocale,
		defaultTimezone,
		rateLimiter,
		rateLimitConfigs: config.rateLimits ?? DEFAULT_RATE_LIMITS,
		circuitBreaker,
		digestEngine,
		emitter,
	};

	// Create broadcast scheduler if Redis + list repos are available
	let broadcastScheduler: BroadcastScheduler | undefined;
	let broadcastService: BroadcastService | undefined;
	if (config.redisClient && repos.listRepository && repos.listMemberRepository) {
		broadcastService = new BroadcastService({
			listRepository: repos.listRepository,
			listMemberRepository: repos.listMemberRepository,
			redis: config.redisClient,
			send: (params: SendParams) => executeSend(params, sendDeps),
			logger,
		});
		broadcastScheduler = createBroadcastScheduler({
			redis: config.redisClient,
			broadcastService,
			logger,
		});
	}

	const lifecycleDeps = {
		providers: allProviders,
		logger,
		redis: config.redisClient,
		digestEngine,
		healthCheckTimeoutMs: config.healthCheckTimeoutMs,
	};

	return {
		async send(params: SendParams): Promise<SendResult> {
			return executeSend(params, sendDeps);
		},

		async start(): Promise<void> {
			await doStart(lifecycleDeps);
			await broadcastScheduler?.start();
		},

		async stop(): Promise<void> {
			await broadcastScheduler?.stop();
			await doStop(lifecycleDeps);
		},

		async healthCheck(): Promise<HealthCheckResult> {
			return doHealthCheck(lifecycleDeps);
		},

		on<K extends keyof EmitoInstanceEvents & string>(
			event: K,
			handler: EmitoInstanceEvents[K],
		): void {
			emitter.on(event, handler);
		},

		off<K extends keyof EmitoInstanceEvents & string>(
			event: K,
			handler: EmitoInstanceEvents[K],
		): void {
			emitter.off(event, handler);
		},

		getEventNames(): string[] {
			return eventRegistry.getEventNames();
		},

		getEvent(name: string): EventDefinition {
			return eventRegistry.getEvent(name);
		},

		broadcastService,
		broadcastScheduler,
	};
}
