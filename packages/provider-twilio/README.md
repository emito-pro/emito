<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/provider-twilio

  **Twilio SMS provider adapter for Emito.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)
</div>

## What it is

`@emito/provider-twilio` is the SMS delivery adapter that lets Emito send text
messages through [Twilio](https://www.twilio.com/). It wraps the official
`twilio` SDK in a `ProviderPlugin` that the Emito core engine can register on
the `sms` channel — handling message dispatch, validating credentials at
construction time, and translating Twilio's REST errors into Emito's typed
`EmitoError` codes so the engine can decide what to retry and what to suppress.

> Emito is provider-agnostic: the core engine speaks `ProviderPlugin`, and each
> provider package teaches it how to talk to one delivery service. This package
> is the Twilio implementation for SMS.

## Install

Emito is developed as a pnpm workspace; the `@emito/*` packages are consumed
from within the monorepo. Add the provider to a workspace package as a
workspace dependency:

```jsonc
// package.json
"dependencies": {
  "@emito/provider-twilio": "workspace:*"
}
```

> Standalone npm publishing of the `@emito/*` scope is planned but not yet
> available — install from the workspace for now.

The package depends on the `twilio` SDK (bundled as a dependency) and is built
to run alongside [`@emito/core`](../core/README.md), which consumes the provider
it produces.

## Usage

Create the provider with your Twilio credentials and register it on the `sms`
channel when you build your Emito instance:

```ts
import { createEmito } from "@emito/core";
import { createTwilioProvider } from "@emito/provider-twilio";

const twilio = createTwilioProvider({
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  fromNumber: process.env.TWILIO_FROM_NUMBER!, // e.g. "+15551234567"
});

const emito = createEmito({
  // ...database, redis, repositories, events...
  channels: {
    sms: {
      providers: [twilio],
    },
  },
});
```

`createTwilioProvider` validates its config eagerly: if `accountSid`,
`authToken`, or `fromNumber` is missing, it throws an `EmitoError` with code
`CONFIG_INVALID` before any message is sent.

## API surface

| Export | Kind | Description |
| --- | --- | --- |
| `createTwilioProvider(config)` | function | Builds a `ProviderPlugin` for the `sms` channel. Validates `config`, instantiates the Twilio client, and returns a plugin with `deliver` and `healthCheck`. |
| `TwilioProviderConfig` | type | Shape of the provider config: `accountSid`, `authToken`, `fromNumber` (all required, non-empty strings). |
| `TwilioProviderConfigSchema` | Zod schema | The `zod` schema used to validate `TwilioProviderConfig`, exported for reuse in your own config validation. |

The returned plugin reports `name: "twilio"` and `channel: "sms"`.

### Error mapping

Twilio REST errors raised during `deliver` are translated into Emito's typed
`EmitoError` codes so the engine can apply the right retry and suppression
behavior:

| Condition | Emito error code | Retryable |
| --- | --- | --- |
| HTTP `429` | `RATE_LIMITED` | yes |
| Invalid `to`/`from` number (`21211`, `21614`) | `DELIVERY_INVALID_ADDRESS` | no |
| Unsubscribed recipient (`21610`) | `DELIVERY_SPAM_COMPLAINT` | no |
| Hard bounce (`30005`, `30006`) | `DELIVERY_HARD_BOUNCE` | no |
| Destination unreachable (`30003`) | `PROVIDER_UNAVAILABLE` | yes |
| Authentication failure (`20003`) | `CONFIG_INVALID` | no |
| HTTP `5xx` | `PROVIDER_UNAVAILABLE` | yes |
| Any other Twilio error | `DELIVERY_REJECTED` | no |

## Part of Emito

`@emito/provider-twilio` is one package in the [Emito](../../README.md)
monorepo — self-hosted, provider-agnostic notification infrastructure for
Node.js and TypeScript.

- **Core engine** — [`@emito/core`](../core/README.md)
- **Shared types** — [`@emito/types`](../types/README.md)
- **Other providers** — [`@emito/provider-resend`](../provider-resend/README.md), [`@emito/provider-fcm`](../provider-fcm/README.md)
- See the full package list in the root [`README.md`](../../README.md).

## License

MIT — part of the [Emito](../../README.md) project.
