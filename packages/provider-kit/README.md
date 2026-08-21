<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/provider-kit

  **Shared building blocks for writing Emito provider plugins.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
</div>

## What it is

Every Emito provider does the same four things before it does anything specific
to its service: validate its config, build an error context, translate the
service's failures into `EMITO_ERROR_CODE` values, and guarantee that the caller
only ever sees an `EmitoError`. `@emito/provider-kit` is that shared machinery,
so a provider package contains its integration and nothing else.

> **The kit is optional.** The contract is still `ProviderPlugin` from
> [`@emito/types`](../types/README.md), and a provider written by hand against
> that interface is a first-class citizen. Nothing in the engine knows this
> package exists.

Its only dependency is `@emito/types`. It pulls in no validation library, no
test runner and no HTTP client, so adding it to a provider costs nothing at
install time.

## Install

```jsonc
// package.json
{
  "dependencies": {
    "@emito/provider-kit": "workspace:*",
    "@emito/types": "workspace:*"
  }
}
```

## Usage

`defineProvider` turns a declarative definition into the
`(config) => ProviderPlugin` factory a provider exports:

```ts
import { defineProvider, deliveryError, httpDeliveryError, providerFetch } from "@emito/provider-kit";
import { EMITO_ERROR_CODE } from "@emito/types";
import { z } from "zod";

export const AcmeProviderConfigSchema = z.object({
  apiKey: z.string().min(1, "apiKey is required"),
  from: z.string().min(1, "from is required"),
});

export type AcmeProviderConfig = z.infer<typeof AcmeProviderConfigSchema>;

export const createAcmeProvider = defineProvider<"sms", AcmeProviderConfig, AcmeContext>({
  name: "acme",
  displayName: "Acme",
  channel: "sms",
  configSchema: AcmeProviderConfigSchema,

  setup: ({ apiKey, from }) => ({ apiKey, from }),

  // `params` is SmsDeliveryParams here — narrowed by the channel, no cast needed.
  deliver: async (params, { apiKey, from }, errorContext) => {
    const response = await providerFetch(
      "https://api.acme.test/send",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ to: params.to, from, text: params.body }),
      },
      { displayName: "Acme", context: errorContext },
    );

    if (!response.ok) {
      throw httpDeliveryError({
        displayName: "Acme",
        status: response.status,
        context: errorContext,
      });
    }

    return { success: true };
  },
});
```

What the wrapper handles so the definition doesn't have to:

| Concern | Behavior |
| --- | --- |
| Config validation | `configSchema` is applied before `setup`; a failure throws `CONFIG_INVALID` naming the provider, with the field errors — never the values — in the context. |
| Channel narrowing | `deliver` receives the params type for its channel, not the `ChannelDeliveryParams` union. |
| Error context | Built per delivery as `{ provider, channel, notificationId, subscriberId }` and passed to `deliver`. |
| Terminal catch | An `EmitoError` propagates untouched; anything else goes to `mapError`, then falls back to a retryable `PROVIDER_UNAVAILABLE` carrying the original as `cause`. |
| `healthCheck` | Defaults to reporting healthy — a broken provider is one whose `setup` threw. |

### Classifying errors

`deliveryError(code, message, { context, cause })` builds an `EmitoError`.
There is deliberately no `isRetryable` parameter: retryability is a property of
the code, and `RETRYABLE_RECORD` in `@emito/types` is the table the delivery
engine actually reads. A provider that sets the flag by hand can only agree with
that table or contradict it.

For HTTP-backed services, `httpDeliveryError` applies the shared ladder — `429`
is rate limiting, `5xx` is the provider being down, everything else is a
rejection not worth retrying. A service that gives a status its own meaning
passes `overrides`:

```ts
throw httpDeliveryError({
  displayName: "Acme",
  status: response.status,
  detail: await readErrorBody(response),
  context: errorContext,
  overrides: { 404: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS },
});
```

When the service reports failures through its own error codes rather than the
status line, classify with a lookup table and fall back to `classifyHttpStatus`:

```ts
const ACME_ERRORS = {
  1201: { code: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS, label: "invalid address" },
  1500: { code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE, label: "temporary error" },
};
```

SDK-thrown errors are classified in `mapError`, which returns `undefined` to
accept the default:

```ts
mapError: (err, errorContext) =>
  isAcmeError(err) ? mapAcmeError(err, errorContext) : undefined,
```

### Keeping secrets out of error contexts

The error context is logged and persisted on dead-letter records. It carries
correlation ids only — credentials, recipient addresses, webhook URLs and
message bodies must not be added to it. Response bodies belong in the error
*message*, not the context.

## API surface

| Export | Kind | Description |
| --- | --- | --- |
| `defineProvider(definition)` | function | Builds a `(config) => ProviderPlugin` factory. |
| `deliveryError(code, message, options?)` | function | An `EmitoError` whose retryability comes from the canonical table. |
| `deliveryErrorContext(provider, channel, metadata)` | function | The standard four-field error context. |
| `classifyHttpStatus(status, overrides?)` | function | HTTP status → `EmitoErrorCode`. |
| `httpDeliveryError(params)` | function | A classified, phrased error for a failed HTTP response. |
| `providerFetch(url, init, options)` | function | `fetch` with a deadline; a timeout becomes `PROVIDER_TIMEOUT`. |
| `resolveFetch(fetchFn?)` | function | Injected fetch, or a lazy binding to the global. |
| `readErrorBody(response)` | function | Response body for an error message, never throwing. |
| `DEFAULT_TIMEOUT_MS` | const | `10_000` — the default request deadline. |
| `DeliveryParamsFor<C>` | type | Narrows `ChannelDeliveryParams` to one channel. |
| `ProviderDefinition`, `ConfigSchema`, `DeliveryErrorContext`, `FetchOptions` | types | Definition and helper shapes. |

`ConfigSchema` is structural — a Zod schema satisfies it, and so does any
validator exposing a compatible `safeParse`.

## Testing helpers

`@emito/provider-kit/testing` ships fixtures and assertions with no test-runner
dependency, so it works under vitest, `node:test` or anything else:

```ts
import { assertContextOmits, assertEmitoError, smsParams } from "@emito/provider-kit/testing";

try {
  await provider.deliver(smsParams({ to: "+48123456789" }));
} catch (err) {
  assertEmitoError(err, { code: EMITO_ERROR_CODE.RATE_LIMITED, isRetryable: true });
  assertContextOmits(err, ["+48123456789", config.apiKey]);
}
```

| Export | Description |
| --- | --- |
| `deliveryMetadata(overrides?)` | Default `DeliveryMetadata`. |
| `emailParams`, `smsParams`, `pushParams`, `slackParams`, `telegramParams` | Channel params builders taking overrides. |
| `assertEmitoError(err, expected)` | Asserts code, optional retryability and context subset; returns the narrowed error. |
| `assertContextOmits(err, forbidden)` | Asserts no listed substring leaked into the error context. |

## Part of Emito

`@emito/provider-kit` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Shared contracts** — [`@emito/types`](../types/README.md)
- **Core engine** — [`@emito/core`](../core/README.md)
- **A provider built on this kit** — [`@emito/provider-smsapi`](../provider-smsapi/README.md)
- See [Adding a provider](../../CONTRIBUTING.md#adding-a-provider) in the
  contribution guide.

## License

MIT — part of the [Emito](../../README.md) project.
