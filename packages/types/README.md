<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/types

  **Shared TypeScript contracts and Zod schemas — the single source of truth for the Emito platform.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)
  [![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)](#)
</div>

## What it is

`@emito/types` is the contract layer that every other Emito package builds on. It holds the
shared type definitions — channels, delivery statuses, send parameters and results, provider
plugins, templates, preferences, transport, and the canonical error model — alongside the Zod
schemas that validate them at runtime. The engine, the HTTP server, the providers and the client
SDKs all import from here so a `Channel`, a `DeliveryStatus`, or a `SendResult` means exactly the same
thing on every side of the wire.

> Keeping the contracts in one package means a change to a status value or an error code is made
> once and propagates by `tsc` to every consumer, rather than drifting between layers.

## Install

Emito is developed as a pnpm workspace; the `@emito/*` packages are consumed
from within the monorepo. Add the types package to a workspace package as a
workspace dependency:

```jsonc
// package.json
"dependencies": {
  "@emito/types": "workspace:*"
}
```

> Standalone npm publishing of the `@emito/*` scope is planned but not yet
> available — install from the workspace for now.

`zod` is a direct dependency and is installed automatically; the schema exports are backed by it.

## Usage

Types are pure compile-time contracts; the schemas, error class, and status helpers are real
runtime values.

```ts
import {
  EmitoConfigSchema,
  SendParamsSchema,
  EmitoError,
  classifyStatus,
  isTerminal,
} from "@emito/types";
import type { SendParams, DeliveryStatus } from "@emito/types";

// Validate untrusted input against a schema
const params: SendParams = SendParamsSchema.parse({
  event: "welcome",
  subscriberId: "sub_123",
  payload: { name: "Ada" },
});

// Classify a delivery status
const status: DeliveryStatus = "opened";
classifyStatus(status); // "engagement"
isTerminal("delivered"); // true

// Construct a typed, code-tagged error
throw new EmitoError({
  code: "DELIVERY_FAILED",
  message: "Provider rejected the message",
  isRetryable: true,
});
```

## API surface

A single entry point (`@emito/types`) re-exports everything. Highlights:

| Export | Kind | Purpose |
| --- | --- | --- |
| `Channel` | type | Supported delivery channels (`email`, `sms`, `push`, `inApp`, `webhook`, `slack`, `telegram`, `discord`, `whatsapp`, `webPush`). |
| `DeliveryStatus`, `DeliveryStatusCategory` | type | Lifecycle and engagement statuses for a delivery. |
| `classifyStatus`, `isTerminal` | function | Classify a status as `delivery`/`engagement` and test for terminal states. |
| `SendParams`, `SendResult`, `ChannelResult` | type | The shape of a send request and its per-channel outcome. |
| `EmitoConfig`, `ChannelConfig`, `RetryPolicy`, `RateLimitConfig` | type | Platform and per-channel configuration contracts. |
| `EmitoEvents`, `EmitoCategories`, `EventDefinition`, `CategoryDefinition` | type | Event and category catalog definitions. |
| `EventTemplate`, `RenderContext`, and per-channel `*Content` | type | Template definitions and channel-specific rendered content. |
| `ProviderPlugin`, `ChannelDeliveryParams`, `DeliveryResult` | type | The provider plugin interface and delivery I/O. |
| `Subscriber`, `PreferenceRecord`, `PreferenceResolutionResult` | type | Subscriber identity and preference resolution contracts. |
| `NotificationEvent`, `EmitoTransport` | type | Real-time transport contract for in-app/feed delivery. |
| `EmitoError`, `EmitoErrorOptions`, `EmitoErrorCode` | class/type | The canonical error model with a frozen error-code enum. |
| `EMITO_ERROR_CODE`, `ERROR_STATUS_CODES`, `RETRYABLE_CODES`, `SUPPRESSABLE_ERROR_CODES` | const | Error-code constants and their retry/suppress/HTTP-status mappings. |
| `Logger` | type | Minimal logger interface used across the platform. |
| `*Schema` (e.g. `EmitoConfigSchema`, `SendParamsSchema`, `SubscriberSchema`) | Zod schema | Runtime validators that mirror the corresponding types. |

Every type has a `.d.ts`; the package ships an ESM build and is consumed via the single `.` export.

## Part of Emito

`@emito/types` is one package in the [Emito](../../README.md) monorepo — self-hosted,
provider-agnostic notification infrastructure for Node.js and TypeScript.

- **Core engine** — [`@emito/core`](../core/README.md)
- **HTTP server** — [`@emito/server`](../server/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
