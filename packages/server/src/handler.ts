import type {
	ConsentRepository,
	DeadLetterRepository,
	Emito,
	InboxRepository,
	IntegrationRepository,
	ListMemberRepository,
	ListRepository,
	NotificationRepository,
	PreferenceRepository,
	RedisLike,
	SubscriberRepository,
	SuppressionRepository,
	WorkspaceDefaultRepository,
} from "@emito/core";
import {
	ListMemberConfirmAdapter,
	MembershipService,
	canTransition,
	transitionStatus as coreTransitionStatus,
	isDeliveryStatus,
} from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { Logger, ResolveSubscriberId } from "@emito/types";
import type { z } from "zod";
import { validateApiKey } from "./auth/api-key.js";
import { signHS256 } from "./auth/hs256.js";
import type { ResolveWorkspaceRole } from "./auth/workspace-role.js";
import { enforceWorkspaceRole } from "./auth/workspace-role.js";
import { registerAdminBroadcastEndpoint } from "./endpoints/admin/broadcast.js";
import { registerAdminConsentEndpoints } from "./endpoints/admin/consents.js";
import { registerAdminDeadLetterEndpoints } from "./endpoints/admin/dead-letters.js";
import { registerAdminListEndpoints } from "./endpoints/admin/lists.js";
import { registerAdminNotificationEndpoints } from "./endpoints/admin/notifications.js";
import { registerAdminSubscriberEndpoints } from "./endpoints/admin/subscribers.js";
import { registerAdminSuppressionEndpoints } from "./endpoints/admin/suppression.js";
import { registerAdminWorkspaceEndpoints } from "./endpoints/admin/workspaces.js";
import { registerCapabilitiesEndpoint } from "./endpoints/capabilities.js";
import { registerConfirmEndpoint } from "./endpoints/confirm/index.js";
import type { ListMemberConfirm } from "./endpoints/confirm/index.js";
import { registerHealthEndpoint } from "./endpoints/health.js";
import { registerMetricsEndpoint } from "./endpoints/metrics.js";
import { registerStubEndpoints } from "./endpoints/stubs.js";
import { registerSubscriberConsentEndpoints } from "./endpoints/subscriber/consents.js";
import { registerSubscriberIntegrationEndpoints } from "./endpoints/subscriber/integrations.js";
import { registerSubscriberListEndpoints } from "./endpoints/subscriber/lists.js";
import { registerSubscriberNotificationEndpoints } from "./endpoints/subscriber/notifications.js";
import { registerSubscriberPreferenceEndpoints } from "./endpoints/subscriber/preferences.js";
import { registerTrackingEndpoints } from "./endpoints/tracking/index.js";
import { registerUnsubscribeEndpoints } from "./endpoints/unsubscribe/index.js";
import { registerWebhookEndpoints } from "./endpoints/webhooks/webhooks.js";
import { registerWorkspaceDefaultEndpoints } from "./endpoints/workspace/defaults.js";
import { registerWorkspaceIntegrationEndpoints } from "./endpoints/workspace/integrations.js";
import { registerWorkspaceMemberEndpoints } from "./endpoints/workspace/members.js";
import { registerWorkspacePreferenceEndpoints } from "./endpoints/workspace/preferences.js";
import { resolveLogger } from "./logger.js";
import { parseQueryString } from "./query.js";
import { handleError } from "./response.js";
import { API_VERSION, createRouter } from "./router.js";
import type { AuthScope, RouteConfig, RuntimeRouteContext } from "./router.js";
import { registerPollingEndpoint } from "./transport/polling.js";
import { ConnectionRegistry } from "./transport/registry.js";
import { registerSSEEndpoint } from "./transport/sse.js";
import { createWsUpgradeHandler } from "./transport/ws-handler.js";

export interface EmitoServerRepositories {
	subscriberRepository: SubscriberRepository;
	notificationRepository: NotificationRepository;
	deadLetterRepository: DeadLetterRepository;
	suppressionRepository: SuppressionRepository;
	integrationRepository: IntegrationRepository;
	workspaceDefaultRepository: WorkspaceDefaultRepository;
	inboxRepository: InboxRepository;
	preferenceRepository: PreferenceRepository;
	consentRepository: ConsentRepository;
	listRepository?: ListRepository;
	listMemberRepository?: ListMemberRepository;
}

export interface EmitoServerConfig {
	emito: Emito;
	apiKey: string;
	prefix?: string;
	includeErrorContext?: boolean;
	resolveWorkspaceRole?: ResolveWorkspaceRole;
	metricsRenderer?: () => Promise<string>;
	repositories: EmitoServerRepositories;
	/** Redis client for real-time transport (SSE, polling, cross-instance fanout). */
	redisClient?: RedisLike;
	/** Per-provider webhook signing secrets for inbound webhook verification. */
	webhookSecrets?: Record<string, string>;
	/** Secret for signing/verifying unsubscribe and confirm JWT tokens. */
	unsubscribeSecret?: string;
	/** Repository-like interface for confirming list memberships (double opt-in). */
	listMemberConfirm?: ListMemberConfirm;
	/** Resolve subscriber identity from the request. Required — the server is auth-agnostic. */
	resolveSubscriberId: ResolveSubscriberId;
	/** Optional structured logger (pino-compatible). Silent no-op when not provided. */
	logger?: Logger;
}

export type EmitoServer = ReturnType<typeof createEmitoServer>;

export function createEmitoServer(config: EmitoServerConfig) {
	const prefix = config.prefix ?? "/emito";
	const apiBase = `${prefix}/${API_VERSION}`;
	const includeErrorContext = config.includeErrorContext ?? false;
	const logger = resolveLogger(config.logger);
	const router = createRouter(prefix, API_VERSION);

	// Register built-in endpoints
	registerHealthEndpoint(router, config.emito);
	registerMetricsEndpoint(router, config.metricsRenderer);

	// Determine available transports
	const transports: string[] = ["sse", "polling"];
	// WS is always available when the server is created (upgrade handler is always built)
	transports.unshift("ws");

	registerCapabilitiesEndpoint(router, { transports });

	// Register admin endpoints
	const repos = config.repositories;
	registerAdminSubscriberEndpoints(router, {
		subscriberRepository: repos.subscriberRepository,
	});
	registerAdminNotificationEndpoints(router, {
		notificationRepository: repos.notificationRepository,
	});
	registerAdminDeadLetterEndpoints(router, {
		deadLetterRepository: repos.deadLetterRepository,
		emito: config.emito,
	});
	registerAdminSuppressionEndpoints(router, {
		suppressionRepository: repos.suppressionRepository,
	});
	registerAdminWorkspaceEndpoints(router, {
		integrationRepository: repos.integrationRepository,
		workspaceDefaultRepository: repos.workspaceDefaultRepository,
	});
	registerAdminConsentEndpoints(router, {
		consentRepository: repos.consentRepository,
	});
	if (repos.listRepository) {
		registerAdminListEndpoints(router, {
			listRepository: repos.listRepository,
		});
	}
	if (config.emito.broadcastService && config.emito.broadcastScheduler) {
		registerAdminBroadcastEndpoint(router, {
			broadcastService: config.emito.broadcastService,
			broadcastScheduler: config.emito.broadcastScheduler,
		});
	}

	// Register subscriber endpoints
	registerSubscriberNotificationEndpoints(router, repos.inboxRepository);
	registerSubscriberPreferenceEndpoints(router, repos.preferenceRepository, config.emito);
	registerSubscriberIntegrationEndpoints(router, repos.integrationRepository);
	registerSubscriberConsentEndpoints(router, repos.consentRepository);
	if (repos.listRepository && repos.listMemberRepository && config.unsubscribeSecret) {
		const membershipService = new MembershipService({
			listRepository: repos.listRepository,
			listMemberRepository: repos.listMemberRepository,
			tokenSigner: { sign: signHS256 },
			unsubscribeSecret: config.unsubscribeSecret,
			confirmEmailSender: {
				async sendConfirmationEmail(subscriberId, token, listName) {
					await config.emito.send({
						event: "list.confirm",
						subscriberId,
						payload: { token, listName },
					});
				},
			},
		});
		registerSubscriberListEndpoints(router, { membershipService });
	}

	// Register workspace endpoints
	registerWorkspacePreferenceEndpoints(
		router,
		repos.preferenceRepository,
		config.resolveWorkspaceRole,
	);
	registerWorkspaceDefaultEndpoints(router, repos.workspaceDefaultRepository);
	registerWorkspaceIntegrationEndpoints(router, repos.integrationRepository);
	registerWorkspaceMemberEndpoints(router, repos.preferenceRepository);

	// Register transport endpoints (SSE, polling)
	const registry = new ConnectionRegistry({ redis: config.redisClient });
	registerSSEEndpoint(router, { registry, redis: config.redisClient });
	registerPollingEndpoint(router, { redis: config.redisClient });

	// Wire notification events to the connection registry
	config.emito.on("notification:created", (subscriberId, event) => {
		void registry.broadcast(subscriberId, event);
	});

	// Register webhook endpoints
	if (config.webhookSecrets) {
		registerWebhookEndpoints(router, {
			notificationRepository: repos.notificationRepository,
			suppressionRepository: repos.suppressionRepository,
			webhookSecrets: config.webhookSecrets,
			logger: logger.child({ component: "webhooks" }),
		});
	}

	// Register tracking endpoints (open pixel + click redirect)
	registerTrackingEndpoints(router, {
		notificationRepository: repos.notificationRepository,
		subscriberRepository: repos.subscriberRepository,
		logger: logger.child({ component: "tracking" }),
		async transitionStatus(notificationId, status, metadata) {
			const notification = await repos.notificationRepository.findById(notificationId);
			if (!notification) return;
			const from = (metadata?.from as string) ?? notification.status;
			if (!isDeliveryStatus(from)) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.DELIVERY_FAILED,
					message: `Invalid delivery status: ${from}`,
					isRetryable: false,
					context: { notificationId, status: from },
				});
			}
			if (!canTransition(from, status)) return;
			await coreTransitionStatus(repos.notificationRepository, {
				notificationId,
				from,
				to: status,
			});
		},
	});

	// Register unsubscribe + confirm endpoints
	if (config.unsubscribeSecret) {
		registerUnsubscribeEndpoints(router, {
			subscriberRepository: repos.subscriberRepository,
			preferenceRepository: repos.preferenceRepository,
			unsubscribeSecret: config.unsubscribeSecret,
		});
		const listMemberConfirm =
			config.listMemberConfirm ??
			(repos.listRepository && repos.listMemberRepository
				? new ListMemberConfirmAdapter(repos.listMemberRepository, repos.listRepository)
				: undefined);
		if (listMemberConfirm) {
			registerConfirmEndpoint(router, {
				listMemberConfirm,
				unsubscribeSecret: config.unsubscribeSecret,
				prefix,
			});
		}
	}

	// Create WS upgrade handler
	const handleUpgrade = createWsUpgradeHandler({
		basePath: apiBase,
		registry,
		redis: config.redisClient,
		inboxRepository: repos.inboxRepository,
		resolveSubscriberId: config.resolveSubscriberId,
	});

	// Register stub endpoints (must be after real endpoints to avoid shadowing)
	registerStubEndpoints(router);

	function addRoute<
		A extends AuthScope,
		P extends z.ZodType | undefined = undefined,
		Q extends z.ZodType | undefined = undefined,
		B extends z.ZodType | undefined = undefined,
	>(route: RouteConfig<A, P, Q, B>): void {
		router.add(route);
	}

	async function handler(request: Request): Promise<Response> {
		try {
			const url = new URL(request.url, "http://localhost");
			const method = request.method;
			const pathname = url.pathname;

			const result = router.match(method, pathname);
			if (!result) {
				return handleError(
					new EmitoError({
						code: EMITO_ERROR_CODE.ROUTE_NOT_FOUND,
						message: `No route found for ${method} ${pathname}`,
					}),
					includeErrorContext,
				);
			}

			const { route } = result;
			let { params } = result;
			let query: Record<string, string | string[]> | unknown = parseQueryString(url);
			let body: unknown = undefined;
			let rawBody: string | undefined;

			if (method === "POST" || method === "PUT" || method === "PATCH") {
				const contentType = request.headers.get("content-type");
				if (contentType?.includes("application/json")) {
					let text: string;
					try {
						text = await request.text();
					} catch (bodyErr) {
						throw new EmitoError({
							code: EMITO_ERROR_CODE.VALIDATION_ERROR,
							message:
								"Request body unavailable (may have been consumed by middleware — mount Emito handler before body parsers)",
							cause: bodyErr instanceof Error ? bodyErr : undefined,
						});
					}
					rawBody = text;
					if (text) {
						try {
							body = JSON.parse(text);
						} catch {
							throw new EmitoError({
								code: EMITO_ERROR_CODE.VALIDATION_ERROR,
								message: "Invalid JSON in request body",
							});
						}
					}
				} else if (contentType?.includes("application/x-www-form-urlencoded")) {
					let text: string;
					try {
						text = await request.text();
					} catch (bodyErr) {
						throw new EmitoError({
							code: EMITO_ERROR_CODE.VALIDATION_ERROR,
							message:
								"Request body unavailable (may have been consumed by middleware — mount Emito handler before body parsers)",
							cause: bodyErr instanceof Error ? bodyErr : undefined,
						});
					}
					rawBody = text;
				} else {
					// For other content types, attempt to read raw body for signature verification
					try {
						rawBody = await request.text();
					} catch {
						// Body may not be available; ignore
					}
				}
			}

			// Auth — must run before schema validation so unauthenticated requests
			// are rejected with 401 instead of 400 validation errors
			let subscriberId: string | undefined;
			let workspaceRole: "admin" | "member" | null | undefined;

			if (route.auth === "admin") {
				const apiKeyHeader = request.headers.get("x-emito-admin-key");
				if (!apiKeyHeader) {
					throw new EmitoError({
						code: EMITO_ERROR_CODE.AUTH_MISSING_TOKEN,
						message: "Missing X-Emito-Admin-Key header",
					});
				}
				validateApiKey(apiKeyHeader, config.apiKey);
			} else if (route.auth === "subscriber" || route.auth === "workspace") {
				let resolved: string | null;
				try {
					resolved = await config.resolveSubscriberId(request);
				} catch {
					throw new EmitoError({
						code: EMITO_ERROR_CODE.AUTH_INVALID_TOKEN,
						message: "resolveSubscriberId callback failed",
					});
				}

				if (!resolved) {
					throw new EmitoError({
						code: EMITO_ERROR_CODE.AUTH_INVALID_TOKEN,
						message: "Subscriber identity could not be resolved",
					});
				}

				subscriberId = resolved;

				if (route.auth === "workspace") {
					const workspaceId = params.wsId;
					if (!workspaceId) {
						throw new EmitoError({
							code: EMITO_ERROR_CODE.AUTH_INVALID_TOKEN,
							message: "Workspace route missing wsId parameter",
						});
					}
					if (!config.resolveWorkspaceRole) {
						throw new EmitoError({
							code: EMITO_ERROR_CODE.CONFIG_INVALID,
							message: "resolveWorkspaceRole not configured",
						});
					}
					try {
						workspaceRole = await enforceWorkspaceRole(
							config.resolveWorkspaceRole,
							resolved,
							workspaceId,
							method,
						);
					} catch (roleErr) {
						if (roleErr instanceof EmitoError) throw roleErr;
						throw new EmitoError({
							code: EMITO_ERROR_CODE.CONFIG_INVALID,
							message: "resolveWorkspaceRole callback failed",
							context: {
								subscriberId: resolved,
								workspaceId,
							},
							cause: roleErr instanceof Error ? roleErr : undefined,
						});
					}
				}
			}

			// Validate schemas — store parsed (Zod-inferred) results back so ctx receives typed values
			if (route.schema) {
				if (route.schema.params) params = route.schema.params.parse(params);
				if (route.schema.query) query = route.schema.query.parse(query);
				if (route.schema.body) body = route.schema.body.parse(body);
			}

			const ctx: RuntimeRouteContext = {
				params,
				query,
				body,
				rawBody,
				subscriberId,
				workspaceRole,
			};

			return await route.handler(ctx as Parameters<typeof route.handler>[0], request);
		} catch (err) {
			return handleError(err, includeErrorContext);
		}
	}

	// `prefix` stays the mount path (what the host attaches the handler to);
	// `apiBase` is where the versioned routes actually live.
	return { handler, addRoute, router, prefix, apiBase, registry, handleUpgrade };
}
