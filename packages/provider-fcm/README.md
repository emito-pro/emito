<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/provider-fcm

  **Firebase Cloud Messaging push provider plugin for Emito.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)
</div>

## What it is

`@emito/provider-fcm` is a push delivery adapter that sends Emito notifications
through [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging).
It wraps the official `firebase-admin` SDK in a `ProviderPlugin` — the common
interface Emito uses to dispatch a notification to any channel — so the engine
can hand it a `push` payload with one or more device tokens and get back a
normalized `DeliveryResult`.

> Provider plugins keep Emito provider-agnostic: the core engine never talks to
> Firebase directly. It only knows the `ProviderPlugin` contract, and this
> package translates that contract into FCM `send` calls and maps Firebase's
> failures back into Emito's typed error model.

## Install

`@emito/provider-fcm` is a workspace package in the Emito monorepo and is not yet
published to npm. Inside the monorepo, depend on it with the workspace protocol
and add `firebase-admin`, which is required at runtime:

```jsonc
// package.json
{
  "dependencies": {
    "@emito/provider-fcm": "workspace:*",
    "firebase-admin": "^13.0.0"
  }
}
```

`firebase-admin` is the official Firebase Admin SDK. The plugin is designed to be
registered with the Emito core engine alongside other channel providers.
Standalone publishing to npm is planned.

## Usage

`createFcmProvider` validates its config, initializes a dedicated Firebase
Admin app with the supplied service-account credentials, and returns a
`ProviderPlugin` bound to the `push` channel. Register the returned plugin with
the Emito engine, which calls `deliver` with each push payload.

```ts
import { createFcmProvider } from "@emito/provider-fcm";

const provider = createFcmProvider({
  projectId: process.env.FCM_PROJECT_ID!,
  clientEmail: process.env.FCM_CLIENT_EMAIL!,
  privateKey: process.env.FCM_PRIVATE_KEY!,
});

// The engine invokes this; shown here directly for illustration.
const result = await provider.deliver({
  channel: "push",
  tokens: ["fcm-device-token-1", "fcm-device-token-2"],
  title: "Build complete",
  body: "Your deployment finished successfully.",
  data: { url: "/deployments/123" },
  metadata: {
    notificationId: "ntf_123",
    subscriberId: "sub_456",
    eventType: "deploy.succeeded",
  },
});

console.log(result.success, result.providerMessageId, result.invalidTokens);
```

Each token is sent independently. If at least one send succeeds, `deliver`
resolves with `{ success: true }`, a `providerMessageId` of the form
`"<succeeded>/<total>"`, and an optional `invalidTokens` array listing tokens
Firebase reported as no longer registered. If every token fails it throws an
`EmitoError` (from `@emito/types`) with a classified code — the engine uses these
for retry and routing decisions. An empty `tokens` array is treated as a no-op
success.

## API surface

| Export | Kind | Description |
| --- | --- | --- |
| `createFcmProvider(config)` | function | Returns a `ProviderPlugin` for the `push` channel backed by Firebase Cloud Messaging. |
| `FcmProviderConfigSchema` | `z.ZodObject` | Zod schema used to validate provider config. |
| `FcmProviderConfig` | type | Inferred config type: `projectId`, `clientEmail`, and `privateKey`. |

### Configuration

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | `string` | yes | Firebase project ID from the service account. |
| `clientEmail` | `string` | yes | Service-account client email. |
| `privateKey` | `string` | yes | Service-account private key. |

### Error mapping

Firebase messaging errors are translated into `EmitoError` codes from
`@emito/types` so the engine can act on them consistently:

| Condition | Code | Retryable |
| --- | --- | --- |
| Unregistered / invalid registration token | `DELIVERY_INVALID_ADDRESS` | no |
| Rate / message-rate limits | `RATE_LIMITED` | yes |
| Server unavailable / internal / unknown error | `PROVIDER_UNAVAILABLE` | yes |
| Invalid argument / mismatched credential, other rejections | `DELIVERY_REJECTED` | no |
| Non-FCM / unrecognized error | `PROVIDER_UNAVAILABLE` | yes |
| Invalid config | `CONFIG_INVALID` | — (thrown at construction) |

When a token fails with an invalid-address code, it is collected into
`result.invalidTokens` rather than aborting the whole batch — callers can prune
those tokens from their subscriber records.

## Part of Emito

`@emito/provider-fcm` is one package in the [Emito](../../README.md)
monorepo — self-hosted, provider-agnostic notification infrastructure for
Node.js and TypeScript.

- **Shared contracts** — [`@emito/types`](../types/README.md)
- **Core engine** — [`@emito/core`](../core/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
