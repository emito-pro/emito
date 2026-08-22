<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/core

  **The notification engine at the heart of Emito — send pipeline, preference resolution, rate limiting, circuit breaking, and observability.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white)
  ![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)
</div>

## What it is

`@emito/core` is the runtime engine for [Emito](../../README.md). It turns a single
`send` call into a fully resolved delivery: it validates configuration, resolves the
recipient and their channel preferences, renders templates, enforces category and
consent rules, applies rate limits and per-provider circuit breakers, dispatches
across providers with retry, and records the result through structured logging,
Prometheus metrics, and OpenTelemetry traces.

> The engine is storage- and transport-agnostic. It depends only on a set of
> repository **interfaces** and an optional Redis client — never on a concrete
> database driver. You wire in implementations (or use the bundled in-memory ones)
> and bring your own provider plugins.

## Install

```bash
npm install @emito/core
```

Working inside the Emito monorepo instead? Use the workspace protocol:

```jsonc
// package.json
{
  "dependencies": {
    "@emito/core": "workspace:*"
  }
}
```

`@emito/core` pulls in `@emito/types` (shared contracts), `zod` (config validation),
`pino` (logging), `prom-client` (metrics), `@opentelemetry/api` (tracing), and
`ioredis`. Redis is optional at runtime — rate limiting, circuit breaking, the
digest engine, and broadcast scheduling activate only when you pass a `redisClient`.

## Usage

The minimal end-to-end path: define a category and event, supply repositories and a
channel provider, then `send`. The example uses the bundled in-memory repositories
and mock provider so it runs with no external services.

```ts
import {
  createEmito,
  createMockProvider,
  InMemorySubscriberRepository,
  InMemoryNotificationRepository,
  InMemoryPreferenceRepository,
  InMemoryWorkspaceDefaultRepository,
  InMemorySuppressionRepository,
  InMemorySubscriptionRepository,
  InMemoryDeadLetterRepository,
  InMemoryIntegrationRepository,
  InMemoryInboxRepository,
  InMemoryPushTokenRepository,
  InMemoryConsentRepository,
} from "@emito/core";

const emito = createEmito({
  database: { url: process.env.DATABASE_URL! },
  redis: { url: process.env.REDIS_URL! },
  categories: {
    transactional: { policy: "always" },
  },
  events: {
    "user.welcome": { category: "transactional", channels: ["email"] },
  },
  channels: {
    email: { providers: [createMockProvider("email")] },
  },
  repositories: {
    subscriberRepository: new InMemorySubscriberRepository(),
    notificationRepository: new InMemoryNotificationRepository(),
    preferenceRepository: new InMemoryPreferenceRepository(),
    workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
    suppressionRepository: new InMemorySuppressionRepository(),
    subscriptionRepository: new InMemorySubscriptionRepository(),
    deadLetterRepository: new InMemoryDeadLetterRepository(),
    integrationRepository: new InMemoryIntegrationRepository(),
    inboxRepository: new InMemoryInboxRepository(),
    pushTokenRepository: new InMemoryPushTokenRepository(),
    consentRepository: new InMemoryConsentRepository(),
  },
});

await emito.start();

const result = await emito.send({
  event: "user.welcome",
  subscriberId: "user_123",
  recipient: { email: "ada@example.com" },
  payload: { name: "Ada" },
});

await emito.stop();
```

`createEmito` validates the configuration with Zod and checks that every event
references a known category, throwing an `EmitoError` with code `CONFIG_INVALID` if
not. The returned `Emito` instance also exposes `healthCheck()` and a typed event
listener (`emito.on("notification:created", ...)`).

## API surface

The public entry point exports the factory plus the building blocks of the pipeline,
the repository interfaces, bundled in-memory implementations, and the shared
contracts re-exported from `@emito/types`.

### Instance and lifecycle

| Export | Kind | Description |
| --- | --- | --- |
| `createEmito` | function | Builds an `Emito` instance from `EmitoCoreConfig`. |
| `Emito`, `EmitoCoreConfig` | types | Instance shape and configuration contract. |
| `start`, `stop`, `healthCheck` | functions | Lifecycle primitives used by the instance. |
| `executeSend` | function | The standalone send pipeline (`SendDeps`). |
| `createTypedEmitter` | function | Dependency-free typed event emitter. |

### Resilience and routing

| Export | Description |
| --- | --- |
| `createRateLimiter`, `DEFAULT_RATE_LIMITS` | Redis-backed per-channel rate limiting. |
| `createCircuitBreaker`, `DEFAULT_CIRCUIT_BREAKER_CONFIG`, `CIRCUIT_STATE_VALUE` | Per-provider circuit breaker. |
| `createDigestEngine`, `atomicFlush`, `acquireFlushLock` | Time/count-windowed digest batching. |
| `dispatch`, `executeWithRetry`, `calculateDelay`, `shouldRetry` | Dispatch and retry logic. |
| `createPriorityStrategy`, `createRoundRobinStrategy`, `createWeightedStrategy` | Multi-provider dispatch strategies. |
| `resolveSubscriber`, `resolvePreferences`, `routeToIntegrations` | Recipient and preference resolution. |
| `enforceCategory`, `checkSuppression`, `addSuppression` | Category, consent, and suppression gates. |
| `transition`, `canTransition`, `getValidTransitions` | Delivery-status state machine. |

### Services and repositories

| Export | Description |
| --- | --- |
| `ListService`, `MembershipService`, `BroadcastService`, `createBroadcastScheduler` | List and broadcast orchestration. |
| `createConsentService` | Consent recording and lookup. |
| `createEventRegistry` | Event-name registry over the configured events. |
| `SubscriberRepository`, `NotificationRepository`, `PreferenceRepository`, … | Repository **interfaces** the engine depends on. |
| `InMemory*Repository` | In-memory implementations for tests and local runs. |
| `createPassthroughResolver`, `TemplateResolver` | Default template resolution. |

### Observability and Redis

| Export | Description |
| --- | --- |
| `createLogger`, `resolveLogger`, `Logger` | Pino-based structured logging. |
| `createMetrics`, `EmitoMetrics` | `prom-client` metrics. |
| `createTracer`, `startSpan`, `withSpan`, `recordSpanEvent`, `setSpanError` | OpenTelemetry tracing helpers. |
| `IoRedisAdapter`, `createRedisAdapter`, `RedisLike` | Redis client abstraction over `ioredis`. |
| `createMockProvider` | In-memory provider plugin for tests. |

All shared contracts — `SendParams`, `SendResult`, `Channel`, `ProviderPlugin`,
`EmitoConfig`, `EmitoError`, and the matching Zod schemas — are re-exported from
[`@emito/types`](../types/README.md) for convenience.

## Part of Emito

`@emito/core` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Shared contracts** — [`@emito/types`](../types/README.md)
- **HTTP server** — [`@emito/server`](../server/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
