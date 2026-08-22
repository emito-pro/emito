<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/provider-resend

  **Resend email provider plugin for Emito.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)
</div>

## What it is

`@emito/provider-resend` is an email delivery adapter that sends Emito
notifications through [Resend](https://resend.com). It wraps the official
`resend` SDK in a `ProviderPlugin` — the common interface Emito uses to dispatch
a notification to any channel — so the engine can hand it an `email` payload and
get back a normalized `DeliveryResult`.

> Provider plugins keep Emito provider-agnostic: the core engine never talks to
> Resend directly. It only knows the `ProviderPlugin` contract, and this package
> translates that contract into Resend API calls and maps Resend's failures back
> into Emito's typed error model.

## Install

```bash
npm install @emito/provider-resend resend
```

Working inside the Emito monorepo instead? Use the workspace protocol:

```jsonc
// package.json
{
  "dependencies": {
    "@emito/provider-resend": "workspace:*",
    "resend": "^4.0.0"
  }
}
```

`resend` (the official Resend SDK) is required at runtime. The plugin is
designed to be registered with the Emito core engine alongside other channel
providers.

## Usage

`createResendProvider` validates its config and returns a `ProviderPlugin` bound
to the `email` channel. Register the returned plugin with the Emito engine, which
calls `deliver` with each email payload.

```ts
import { createResendProvider } from "@emito/provider-resend";

const provider = createResendProvider({
  apiKey: process.env.RESEND_API_KEY!,
  fromAddress: "Acme <notifications@acme.dev>",
  replyTo: "support@acme.dev", // optional
});

// The engine invokes this; shown here directly for illustration.
const result = await provider.deliver({
  channel: "email",
  to: "user@example.com",
  subject: "Welcome to Acme",
  html: "<h1>Welcome</h1>",
  text: "Welcome",
  metadata: {
    notificationId: "ntf_123",
    subscriberId: "sub_456",
    eventType: "user.welcome",
  },
});

console.log(result.success, result.providerMessageId);
```

On success, `deliver` resolves to `{ success: true, providerMessageId }`. On
failure it throws an `EmitoError` (from `@emito/types`) with a classified code —
the engine uses these for retry and routing decisions.

## API surface

| Export | Kind | Description |
| --- | --- | --- |
| `createResendProvider(config)` | function | Returns a `ProviderPlugin` for the `email` channel backed by Resend. |
| `ResendProviderConfigSchema` | `z.ZodObject` | Zod schema used to validate provider config. |
| `ResendProviderConfig` | type | Inferred config type: `apiKey`, `fromAddress`, and optional `replyTo`. |

### Configuration

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `apiKey` | `string` | yes | Resend API key. |
| `fromAddress` | `string` | yes | Sender address used for every send (e.g. `Name <addr@domain>`). |
| `replyTo` | `string` | no | Default reply-to; falls back to the payload's `replyTo` when unset. |

### Error mapping

Resend errors are translated into `EmitoError` codes from `@emito/types` so the
engine can act on them consistently:

| Condition | Code | Retryable |
| --- | --- | --- |
| Rate limit (HTTP 429) | `RATE_LIMITED` | yes |
| Invalid recipient address | `DELIVERY_INVALID_ADDRESS` | no |
| Resend server error (HTTP 5xx) / unknown failure | `PROVIDER_UNAVAILABLE` | yes |
| Other rejections | `DELIVERY_REJECTED` | no |
| Invalid config | `CONFIG_INVALID` | — (thrown at construction) |

Each outgoing email carries an `X-Entity-Ref-ID` header set to the
notification ID from `metadata` for downstream correlation.

## Part of Emito

`@emito/provider-resend` is one package in the [Emito](../../README.md)
monorepo — self-hosted, provider-agnostic notification infrastructure for
Node.js and TypeScript.

- **Shared contracts** — [`@emito/types`](../types/README.md)
- **Core engine** — [`@emito/core`](../core/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
