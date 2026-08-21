<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/provider-smsapi

  **SMSAPI SMS provider adapter for Emito.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)
</div>

## What it is

`@emito/provider-smsapi` is the SMS delivery adapter that lets Emito send text
messages through [SMSAPI](https://www.smsapi.pl/). It talks to the SMSAPI REST
endpoint directly via `fetch` (no SDK dependency) and exposes a `ProviderPlugin`
that the Emito core engine can register on the `sms` channel — handling message
dispatch, validating credentials at construction time, and translating SMSAPI's
error responses into Emito's typed `EmitoError` codes so the engine can decide
what to retry and what to suppress.

> Emito is provider-agnostic: the core engine speaks `ProviderPlugin`, and each
> provider package teaches it how to talk to one delivery service. This package
> is the SMSAPI implementation for SMS.

## Install

Emito is developed as a pnpm workspace; the `@emito/*` packages are consumed
from within the monorepo. Add the provider to a workspace package as a
workspace dependency:

```jsonc
// package.json
"dependencies": {
  "@emito/provider-smsapi": "workspace:*"
}
```

> Standalone npm publishing of the `@emito/*` scope is planned but not yet
> available — install from the workspace for now.

The package has no third-party SDK dependency — it uses the global `fetch` — and
is built to run alongside [`@emito/core`](../core/README.md), which consumes the
provider it produces.

## Usage

Create the provider with your SMSAPI credentials and register it on the `sms`
channel when you build your Emito instance:

```ts
import { createEmito } from "@emito/core";
import { createSmsapiProvider } from "@emito/provider-smsapi";

const smsapi = createSmsapiProvider({
  accessToken: process.env.SMSAPI_ACCESS_TOKEN!, // OAuth token from smsapi.pl
  from: process.env.SMSAPI_FROM!,                // approved sender name
  // endpoint: "https://api.smsapi.pl/sms.do",   // optional override (default)
});

const emito = createEmito({
  // ...database, redis, repositories, events...
  channels: {
    sms: {
      providers: [smsapi],
    },
  },
});
```

`createSmsapiProvider` validates its config eagerly: if `accessToken` or `from`
is missing, it throws an `EmitoError` with code `CONFIG_INVALID` before any
message is sent. The recipient's `+` prefix is stripped automatically before the
request is sent.

## API surface

| Export | Kind | Description |
| --- | --- | --- |
| `createSmsapiProvider(config)` | function | Builds a `ProviderPlugin` for the `sms` channel. Validates `config` and returns a plugin with `deliver` and `healthCheck`. |
| `SmsapiProviderConfig` | type | Shape of the provider config: `accessToken` and `from` (required, non-empty strings) plus optional `endpoint`. |
| `SmsapiProviderConfigSchema` | Zod schema | The `zod` schema used to validate `SmsapiProviderConfig`, exported for reuse in your own config validation. |

The returned plugin reports `name: "smsapi"` and `channel: "sms"`.

### Error mapping

SMSAPI error responses raised during `deliver` are translated into Emito's typed
`EmitoError` codes so the engine can apply the right retry and suppression
behavior:

| Condition | Emito error code | Retryable |
| --- | --- | --- |
| HTTP `429` | `RATE_LIMITED` | yes |
| Authentication failure (`101`, `102`) | `CONFIG_INVALID` | no |
| Invalid recipient number (`13`, `14`) | `DELIVERY_INVALID_ADDRESS` | no |
| Transient SMSAPI error (`8`, `201`) or HTTP `5xx` | `PROVIDER_UNAVAILABLE` | yes |
| Any other SMSAPI error | `DELIVERY_REJECTED` | no |

Requests carry a 10 second deadline; exceeding it raises a retryable
`PROVIDER_TIMEOUT`. Other network failures become a retryable
`PROVIDER_UNAVAILABLE`.

## Part of Emito

`@emito/provider-smsapi` is one package in the [Emito](../../README.md)
monorepo — self-hosted, provider-agnostic notification infrastructure for
Node.js and TypeScript.

- **Core engine** — [`@emito/core`](../core/README.md)
- **Shared types** — [`@emito/types`](../types/README.md)
- **Other providers** — [`@emito/provider-twilio`](../provider-twilio/README.md), [`@emito/provider-resend`](../provider-resend/README.md), [`@emito/provider-fcm`](../provider-fcm/README.md)
- See the full package list in the root [`README.md`](../../README.md).

## License

MIT — part of the [Emito](../../README.md) project.
