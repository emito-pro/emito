<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/provider-telegram

  **Telegram Bot API provider plugin for Emito notification delivery.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
</div>

## What it is

`@emito/provider-telegram` is a delivery provider plugin that sends notifications
through the [Telegram Bot API](https://core.telegram.org/bots/api). It implements
the `ProviderPlugin` contract from `@emito/types` for the `telegram` channel,
posting each message to the bot's `sendMessage` endpoint with `parse_mode: "HTML"`.

> Providers are deliberately thin. They translate a channel's delivery params into
> one upstream API call and map transport failures to Emito's typed `EmitoError`
> codes, so the core engine can decide what to retry and what to drop.

## Install

```bash
npm install @emito/provider-telegram
```

Working inside the Emito monorepo instead? Use the workspace protocol:

```jsonc
// package.json
{
  "dependencies": {
    "@emito/provider-telegram": "workspace:*"
  }
}
```

The package depends on `@emito/types` for the shared provider and delivery
contracts. It has no other runtime dependencies and uses the platform `fetch`.

## Usage

`createTelegramProvider()` returns a `ProviderPlugin` that you register with the
Emito send pipeline. Delivery params follow the `TelegramDeliveryParams` shape
from `@emito/types`.

```ts
import { createTelegramProvider } from "@emito/provider-telegram";

const provider = createTelegramProvider();

const result = await provider.deliver({
  channel: "telegram",
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: "123456789",
  html: "<b>Build passed</b> — deploy is live.",
  metadata: {
    notificationId: "ntf_123",
    subscriberId: "sub_456",
    eventType: "deploy.succeeded",
  },
});

if (result.success) {
  // message accepted by Telegram
}
```

To inject a custom HTTP client (for testing, proxying, or instrumentation), pass
your own `fetch` implementation:

```ts
const provider = createTelegramProvider({ fetchFn: myFetch });
```

Every request carries a 10 second deadline so a stalled API call cannot hold a
delivery worker open indefinitely. Override it with `timeoutMs`:

```ts
const provider = createTelegramProvider({ timeoutMs: 3_000 });
```

## API surface

| Export | Kind | Description |
| --- | --- | --- |
| `createTelegramProvider(options?)` | function | Builds a `ProviderPlugin` for the `telegram` channel. |
| `options.fetchFn` | `typeof fetch` | Optional. Custom `fetch` used for the API call. Defaults to `globalThis.fetch`. |
| `options.timeoutMs` | `number` | Optional. Per-request deadline. Defaults to `10_000`. |

The returned `ProviderPlugin`:

| Member | Type | Description |
| --- | --- | --- |
| `name` | `"telegram"` | Provider identifier. |
| `channel` | `"telegram"` | Channel this provider serves. |
| `deliver(params)` | `Promise<DeliveryResult>` | Sends the message; resolves `{ success: true }` on success, throws a typed `EmitoError` on failure. |
| `healthCheck()` | `Promise<boolean>` | Returns `true`. |

### Error mapping

`deliver` translates Telegram HTTP responses into `EmitoError` instances with the
appropriate `EMITO_ERROR_CODE` and retry classification:

| HTTP status | Error code | Retryable |
| --- | --- | --- |
| `429` | `RATE_LIMITED` | yes |
| `403` (bot blocked by user) | `DELIVERY_SPAM_COMPLAINT` | no |
| `404` | `DELIVERY_INVALID_ADDRESS` | no |
| `>= 500` | `PROVIDER_UNAVAILABLE` | yes |
| other non-OK | `DELIVERY_REJECTED` | no |

A request that exceeds the deadline becomes a retryable `PROVIDER_TIMEOUT`.
Other network or unexpected errors are wrapped as `PROVIDER_UNAVAILABLE` and
marked retryable.

## Part of Emito

`@emito/provider-telegram` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Shared contracts** — [`@emito/types`](../types/README.md)
- **Slack provider** — [`@emito/provider-slack`](../provider-slack/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
