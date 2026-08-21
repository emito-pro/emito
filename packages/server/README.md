<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/server

  **Framework-agnostic HTTP layer for Emito — REST endpoints, real-time transport, webhooks, and tracking from a single handler.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
  ![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)
</div>

## What it is

`@emito/server` builds the entire Emito HTTP surface on top of the Web Standard
`Request`/`Response` API. `createEmitoServer` wires the core engine and your
repositories into a single `handler(request)` function that serves admin,
subscriber, and workspace REST endpoints, inbound provider webhooks, open/click
tracking, unsubscribe and double-opt-in confirmation pages, and three real-time
transports (WebSocket, Server-Sent Events, long polling). Thin adapters map that
handler onto raw Node.js, Express, Fastify, Next.js, and Hono without changing
any of the routing or auth logic.

> Because the core is a Web `Request` → `Response` function, the framework
> adapters carry no business logic — they only translate the host runtime's
> request/response objects to and from the standard primitives.

## Install

Emito is developed as a pnpm workspace; the `@emito/*` packages are consumed
from within the monorepo. Add the server to a workspace package as a workspace
dependency:

```jsonc
// package.json
"dependencies": {
  "@emito/server": "workspace:*"
}
```

> Standalone npm publishing of the `@emito/*` scope is planned but not yet
> available — install from the workspace for now.

`@emito/server` depends on `@emito/core` and `@emito/types`, and on `zod` for
schema validation and `ws` for WebSocket upgrades. Each framework adapter is a
separate subpath export, so you only pull in the host framework you actually use
(`express`, `fastify`, `next`, or `hono` are provided by your application).

## Usage

`createEmitoServer` returns a `handler`, the WebSocket `handleUpgrade` function,
and the underlying `router`. Mount the handler with the adapter that matches your
runtime — here, a raw Node.js HTTP server:

```ts
import { createServer } from "node:http";
import { createEmitoServer } from "@emito/server";
import { toNodeHandler, toNodeUpgradeHandler } from "@emito/server/node";

const server = createEmitoServer({
  emito,            // an @emito/core Emito instance
  apiKey: process.env.EMITO_ADMIN_KEY!,
  repositories,     // your EmitoServerRepositories implementation
  // Required: the server is auth-agnostic and asks you who the caller is.
  resolveSubscriberId: async (request) => {
    return request.headers.get("x-subscriber-id");
  },
});

const http = createServer(toNodeHandler(server));
http.on("upgrade", toNodeUpgradeHandler(server));
http.listen(3000);
```

Admin routes are authenticated with the `X-Emito-Admin-Key` header against the
configured `apiKey`; subscriber and workspace routes are authenticated through
your `resolveSubscriberId` (and `resolveWorkspaceRole`) callbacks. All endpoints
are mounted under the `prefix` option, which defaults to `/emito`.

### Other runtimes

```ts
// Express
import { emitRouter } from "@emito/server/express";
const { router, upgradeHandler } = emitRouter(server, express);

// Fastify (also auto-wires the WS upgrade for the prefix)
import { createFastifyPlugin } from "@emito/server/fastify";
fastify.register(createFastifyPlugin(server));

// Next.js App Router route handler
import { toNextJsHandler } from "@emito/server/nextjs";
export const { GET, POST, PUT, PATCH, DELETE } = toNextJsHandler(server);

// Hono — registers `${server.prefix}/*` on the app you pass in
import { serve } from "@hono/node-server";
import { createHonoWsHandler, mountHono } from "@emito/server/hono";
mountHono(app, server);
// WS upgrades never reach a Hono handler, so wire them on the Node server
// `@hono/node-server` returns (on Bun/Deno/Workers use SSE or polling instead).
serve({ fetch: app.fetch, port: 3000 }).on("upgrade", createHonoWsHandler(server));
```

## API surface

### Subpath exports

| Import | Provides |
| --- | --- |
| `@emito/server` | `createEmitoServer`, router, auth, response/query helpers, transports, endpoint registrars, schemas, HTML utilities |
| `@emito/server/node` | `toNodeHandler`, `toNodeUpgradeHandler` |
| `@emito/server/express` | `emitRouter` |
| `@emito/server/fastify` | `createFastifyPlugin` |
| `@emito/server/nextjs` | `toNextJsHandler`, `createNextWsHandler` |
| `@emito/server/hono` | `mountHono`, `toHonoHandler`, `createHonoWsHandler` |

### Core exports

| Export | Description |
| --- | --- |
| `createEmitoServer(config)` | Builds the full Emito HTTP server from an `Emito` instance and `EmitoServerRepositories`. Returns `{ handler, addRoute, router, prefix, registry, handleUpgrade }`. |
| `createRouter(prefix)` | Standalone method/path router with typed, Zod-validated route contexts. |
| `validateApiKey`, `enforceWorkspaceRole` | Admin key and workspace-role authorization checks. |
| `signHS256`, `verifyHS256`, `verifyHS256Safe` | HS256 token signing/verification (used for unsubscribe and confirm tokens). |
| `jsonResponse`, `collectionResponse`, `errorResponse`, `handleError` | Web `Response` builders with consistent error shaping. |
| `parseQueryString` | Parses a URL's query string into a typed record. |
| `ConnectionRegistry`, `createConnectionRegistry` | Real-time connection registry with optional Redis cross-instance fanout. |
| `registerSSEEndpoint`, `registerPollingEndpoint`, `createWsUpgradeHandler` | Real-time transport endpoints and the WebSocket upgrade handler. |
| `registerCapabilitiesEndpoint`, `registerHealthEndpoint`, `registerMetricsEndpoint` | Built-in capability discovery, health, and metrics endpoints. |
| `register*Endpoints` | Endpoint registrars for admin, subscriber, and workspace resource groups, plus `registerUnsubscribeEndpoints` and `registerConfirmEndpoint`. |
| `html`, `htmlPage`, `htmlResponse`, `htmlEscape`, `joinHtml`, `mapHtml`, `unsafeRaw` | XSS-safe HTML templating used by the unsubscribe and confirm pages. |
| Schema exports | Zod schemas for admin, subscriber, and workspace request validation (e.g. `cursorQuerySchema`, `createSubscriberBodySchema`, `notificationListQuerySchema`). |

Key types include `EmitoServerConfig`, `EmitoServerRepositories`, `EmitoServer`,
`RouteDefinition`, `RouteContextFor`, `RouteHandler`, `AuthScope`,
`WorkspaceRole`, and `ResolveWorkspaceRole`.

## Part of Emito

`@emito/server` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Core engine** — [`@emito/core`](../core/README.md)
- **Shared types** — [`@emito/types`](../types/README.md)
- **Client SDK** — [`@emito/js`](../js/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
