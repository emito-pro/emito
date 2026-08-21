// Server
export { createEmitoServer } from "./handler.js";
export type { EmitoServerConfig, EmitoServerRepositories, EmitoServer } from "./handler.js";

// Router
export { API_VERSION, createRouter } from "./router.js";
export type {
	AuthScope,
	RouteDefinition,
	RouteMatch,
	RouteContext,
	RouteContextFor,
	RouteHandler,
	RouteSchema,
} from "./router.js";

// Auth
export { validateApiKey } from "./auth/api-key.js";
export { signHS256, verifyHS256, verifyHS256Safe } from "./auth/hs256.js";
export type { HS256Payload } from "./auth/hs256.js";
export { enforceWorkspaceRole } from "./auth/workspace-role.js";
export type { ResolveWorkspaceRole, WorkspaceRole } from "./auth/workspace-role.js";
export type { ResolveSubscriberId } from "@emito/types";

// Response
export {
	jsonResponse,
	collectionResponse,
	errorResponse,
	handleError,
} from "./response.js";
export type { ErrorResponseOptions } from "./response.js";

// Query
export { parseQueryString } from "./query.js";

// Endpoints
export { registerCapabilitiesEndpoint } from "./endpoints/capabilities.js";
export type { CapabilitiesConfig } from "./endpoints/capabilities.js";
export { registerHealthEndpoint } from "./endpoints/health.js";
export { registerMetricsEndpoint } from "./endpoints/metrics.js";
export { registerStubEndpoints } from "./endpoints/stubs.js";

// Transport
export { ConnectionRegistry, createConnectionRegistry } from "./transport/registry.js";
export type { Connection, ConnectionRegistryOptions } from "./transport/registry.js";
export { registerSSEEndpoint } from "./transport/sse.js";
export { registerPollingEndpoint } from "./transport/polling.js";
export { createWsUpgradeHandler } from "./transport/ws-handler.js";
export type { WsHandlerConfig } from "./transport/ws-handler.js";

// Admin endpoints
export { registerAdminSubscriberEndpoints } from "./endpoints/admin/subscribers.js";
export { registerAdminNotificationEndpoints } from "./endpoints/admin/notifications.js";
export { registerAdminDeadLetterEndpoints } from "./endpoints/admin/dead-letters.js";
export { registerAdminSuppressionEndpoints } from "./endpoints/admin/suppression.js";
export { registerAdminWorkspaceEndpoints } from "./endpoints/admin/workspaces.js";

// Subscriber endpoints
export { registerSubscriberNotificationEndpoints } from "./endpoints/subscriber/notifications.js";
export { registerSubscriberPreferenceEndpoints } from "./endpoints/subscriber/preferences.js";
export { registerSubscriberIntegrationEndpoints } from "./endpoints/subscriber/integrations.js";

// Workspace endpoints
export { registerWorkspacePreferenceEndpoints } from "./endpoints/workspace/preferences.js";
export { registerWorkspaceDefaultEndpoints } from "./endpoints/workspace/defaults.js";
export { registerWorkspaceIntegrationEndpoints } from "./endpoints/workspace/integrations.js";
export { registerWorkspaceMemberEndpoints } from "./endpoints/workspace/members.js";

// Unsubscribe + confirm endpoints
export { registerUnsubscribeEndpoints } from "./endpoints/unsubscribe/index.js";
export { validateToken } from "./endpoints/unsubscribe/index.js";
export type { TokenPayload } from "./endpoints/unsubscribe/index.js";
export { registerConfirmEndpoint } from "./endpoints/confirm/index.js";
export type { ListMemberConfirm } from "./endpoints/confirm/index.js";

// HTML utilities
export { htmlEscape } from "./html/index.js";
export type { SafeHtml } from "./html/index.js";
export { html, htmlPage, htmlResponse, joinHtml, mapHtml, unsafeRaw } from "./html/index.js";

// Subscriber schemas
export {
	notificationIdParamsSchema,
	notificationListQuerySchema,
	snoozeBodySchema,
	preferenceBodySchema,
	integrationCreateBodySchema,
	integrationUpdateBodySchema,
	integrationIdParamsSchema,
} from "./schemas/subscriber.js";

// Workspace schemas
export {
	workspaceIdParamsSchema,
	workspaceIntegrationIdParamsSchema,
	workspacePreferenceBodySchema,
	workspaceDefaultsBodySchema,
	workspaceIntegrationCreateBodySchema,
	workspaceIntegrationUpdateBodySchema,
} from "./schemas/workspace.js";

// Framework adapters
export { toNodeHandler, toNodeUpgradeHandler } from "./adapters/node.js";
export type { NodeHandlerOptions } from "./adapters/node.js";
export { emitRouter } from "./adapters/express.js";
export type { EmitoRouterResult } from "./adapters/express.js";
export { createFastifyPlugin } from "./adapters/fastify.js";
export { toNextJsHandler, createNextWsHandler } from "./adapters/nextjs.js";
export type { NextJsHandlers } from "./adapters/nextjs.js";
export { toHonoHandler, mountHono, createHonoWsHandler } from "./adapters/hono.js";
export type { HonoLikeApp } from "./adapters/hono.js";

// Admin list endpoints
export { registerAdminListEndpoints } from "./endpoints/admin/lists.js";

// Subscriber list endpoints
export { registerSubscriberListEndpoints } from "./endpoints/subscriber/lists.js";

// Admin schemas
export {
	cursorQuerySchema,
	idParamSchema,
	createSubscriberBodySchema,
	notificationFilterSchema,
	deadLetterFilterSchema,
	suppressionFilterSchema,
	createSuppressionBodySchema,
	workspaceIdParamSchema,
	setWorkspaceDefaultsBodySchema,
	createWorkspaceIntegrationBodySchema,
	createListBodySchema,
	updateListBodySchema,
	listFilterSchema,
	listMemberFilterSchema,
	slugParamSchema,
} from "./schemas/admin.js";
