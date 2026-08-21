---
title: Architecture
description: The moving parts of a self-hosted Emito deployment.
---

Emito runs entirely inside your infrastructure: your Postgres, your Redis, your processes. There is no external control plane.

## The pieces

- **`@emito/core`**: the engine. The send pipeline, preference resolution, rate limiting, the circuit breaker, digests, observability hooks. Framework-agnostic, no HTTP in it at all.
- **`@emito/server`**: wraps `@emito/core` in a REST + realtime API, with adapters for Express, Fastify, Next.js, Hono, and generic Node (`http.createServer`). See [Prerequisites](/prerequisites/) for the current, authoritative list.
- **`@emito/db`**: the Drizzle schema (the `emito_`-prefixed tables) and repository implementations `@emito/core` consumes.
- **Providers**: `@emito/provider-resend`, `@emito/provider-twilio`/`@emito/provider-smsapi`, and anything implementing `ProviderPlugin` (see [Channels & providers](/concepts/channels/)).
- **`@emito/react`** (or the headless `@emito/react-hooks`, or `@emito/react-native` for mobile): the client, talking to `@emito/server`'s REST + realtime endpoints. `@emito/js` is the framework-agnostic client underneath all three, and the direct way in for a non-React frontend.

## Postgres and Redis

- **Postgres** holds every `emito_`-prefixed table: subscribers, notifications, preferences, the inbox, suppression/dead-letter records. Nothing here is optional; there's no in-memory fallback for production use.
- **Redis** backs rate limiting, digest batching (buffering events before a scheduled flush), and realtime fanout (see below). A `RedisLike` adapter interface means any Redis-compatible client works, not just `ioredis`.

## Realtime: three transports, one connection registry

The frontend gets live inbox updates over one of three transports, **SSE**, **long-polling**, or **WebSocket**, chosen per deployment (see [Frontend](/frontend/) for when to pick which; browser WebSocket can't carry a Bearer header, which rules it out for Bearer-token auth over a persistent connection). Whichever transport is active, the same **connection registry** fans a single `notification:created` event out to every connected client across every server instance. It's the one piece of realtime plumbing shared by all three transports, backed by a Redis stream (`emito:stream:{subscriberId}`) rather than in-process pub/sub, so it works correctly across multiple server processes/instances.

## The split send/serve pattern

If the process that calls `emito.send()` (often a background worker) is a *different* process from the one serving the realtime connections (your API), the sending process must explicitly bridge into the same connection registry the API uses. Otherwise notifications land correctly in the inbox table but never push live, only appearing on the next manual refresh. This is already a numbered item in the [Gotchas checklist](/gotchas/) and a fully worked example in [Backend](/backend/); this page's job is just to name it as the one cross-cutting architectural decision every multi-process deployment has to make correctly.
