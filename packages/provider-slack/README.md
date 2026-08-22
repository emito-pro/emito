<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/provider-slack

  **Slack Incoming Webhook delivery adapter for the Emito notification engine.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
</div>

## What it is

`@emito/provider-slack` is the Slack channel provider for Emito. It implements
the `ProviderPlugin` contract from [`@emito/types`](../types/README.md) and
delivers messages by POSTing a JSON payload to a Slack
[Incoming Webhook](https://api.slack.com/messaging/webhooks) URL. The payload
carries both `blocks` (Slack Block Kit) and a `text` fallback, and HTTP failures
are mapped onto Emito's typed `EmitoError` codes so the engine can decide whether
to retry.

> The provider holds no credentials of its own — the destination `webhookUrl`
> arrives per delivery in the channel params, so a single provider instance
> serves every tenant and every workspace.

## Install

```bash
npm install @emito/provider-slack
```

Working inside the Emito monorepo instead? Use the workspace protocol:

```jsonc
// package.json
{
  "dependencies": {
    "@emito/provider-slack": "workspace:*"
  }
}
```

Its only runtime dependency is `@emito/types`, the shared type layer.

## Usage

```ts
import { createSlackProvider } from "@emito/provider-slack";

const slack = createSlackProvider();

const result = await slack.deliver({
  channel: "slack",
  webhookUrl: "https://hooks.slack.com/services/T000/B000/XXXX",
  text: "Build #1429 passed",
  blocks: [
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Build #1429* passed :white_check_mark:" },
    },
  ],
  metadata: {
    notificationId: "ntf_123",
    subscriberId: "sub_456",
    eventType: "build.passed",
  },
});

// result.success === true on a 2xx response from Slack
```

Within Emito you register the provider with the engine rather than calling
`deliver` directly; the engine resolves the `slack` channel to this plugin.

### Injecting a custom `fetch`

`createSlackProvider` accepts an optional `fetchFn` so you can supply your own
`fetch` implementation — useful for tests, instrumentation, or a non-global
client.

```ts
const slack = createSlackProvider({ fetchFn: myFetch });
```

### Request deadline

Every request carries a 10 second deadline so a stalled webhook cannot hold a
delivery worker open indefinitely. Override it with `timeoutMs`:

```ts
const slack = createSlackProvider({ timeoutMs: 3_000 });
```

## API surface

| Export | Kind | Description |
| --- | --- | --- |
| `createSlackProvider(options?)` | function | Builds a `ProviderPlugin` with `name`/`channel` set to `"slack"`. |
| `options.fetchFn` | `typeof fetch` (optional) | Custom fetch implementation; defaults to `globalThis.fetch`. |
| `options.timeoutMs` | `number` (optional) | Per-request deadline; defaults to `10_000`. |

The returned `ProviderPlugin` exposes:

| Member | Signature | Behavior |
| --- | --- | --- |
| `deliver` | `(params: ChannelDeliveryParams) => Promise<DeliveryResult>` | POSTs `{ blocks, text }` to `webhookUrl`; resolves `{ success: true }` on a 2xx response, throws an `EmitoError` otherwise. |
| `healthCheck` | `() => Promise<boolean>` | Always resolves `true` (webhook delivery is stateless). |

### Error mapping

Non-2xx responses are translated into `EmitoError` instances with codes from
`@emito/types`, carrying the retry hint the engine uses:

| HTTP status | `EMITO_ERROR_CODE` | Retryable |
| --- | --- | --- |
| `429` | `RATE_LIMITED` | yes |
| `404` | `DELIVERY_INVALID_ADDRESS` | no |
| `5xx` | `PROVIDER_UNAVAILABLE` | yes |
| other non-2xx | `DELIVERY_REJECTED` | no |

A request that exceeds the deadline becomes a retryable `PROVIDER_TIMEOUT`.
Other network-level failures (a rejected `fetch`) become a retryable
`PROVIDER_UNAVAILABLE` error carrying the original as `cause`.

## Part of Emito

`@emito/provider-slack` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Shared contracts** — [`@emito/types`](../types/README.md)
- **Core engine** — [`@emito/core`](../core/README.md)
- **Telegram provider** — [`@emito/provider-telegram`](../provider-telegram/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
