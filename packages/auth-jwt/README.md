<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/auth-jwt

  **HS256 JWT signing and verification for Emito subscriber sessions.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
</div>

## What it is

`@emito/auth-jwt` is a dependency-free helper for issuing and verifying compact
HS256 JSON Web Tokens (`header.payload.signature`). It signs and validates tokens
using Node's built-in `crypto` (HMAC-SHA256) and ships a ready-made
`resolveSubscriberId` adapter that extracts a `Bearer` token from an incoming
`Request`, verifies it, and returns the `subscriberId` claim — the exact shape
`@emito/server` expects for subscriber authentication.

> The verifier pins the algorithm to `HS256` and rejects anything else, uses a
> timing-safe signature comparison, and never throws — every failure path
> returns `null`. The signer is intentionally deterministic: callers own the
> `iat`/`exp` claims so tokens stay testable.

## Install

`@emito/auth-jwt` is a workspace package in the Emito monorepo and is not yet
published to npm. Inside the monorepo, depend on it with the workspace protocol:

```jsonc
// package.json
{
  "dependencies": {
    "@emito/auth-jwt": "workspace:*"
  }
}
```

Runtime is Node.js (the package relies on the `node:crypto` module). No other
runtime dependencies are required beyond `@emito/types`, which resolves through
the workspace. Standalone publishing to npm is planned.

## Usage

```ts
import { createJwtAuth, signHS256, verifyHS256 } from "@emito/auth-jwt";

const secret = process.env.JWT_SECRET!;

// Issue a token for a subscriber (you own the expiry claim).
const now = Math.floor(Date.now() / 1000);
const token = signHS256(
  { subscriberId: "sub_123", iat: now, exp: now + 3600 },
  secret,
);

// Verify it directly.
const result = verifyHS256(token, secret);
if (result) {
  console.log(result.payload.subscriberId); // "sub_123"
}

// Or wire it into an Emito server as the subscriber resolver.
import { createEmitoServer } from "@emito/server";

const server = createEmitoServer({
  // ...other config
  resolveSubscriberId: createJwtAuth({ hmacSecret: secret }),
});
```

`createJwtAuth` returns an `async (req: Request) => string | null` function. It
reads the `Authorization: Bearer <token>` header, verifies the token, and
resolves to the `subscriberId` claim (a non-empty string) or `null` if the
header is missing, malformed, or the token fails verification.

> **Browser WebSocket clients need the cookie fallback.** A browser's native
> `WebSocket` constructor can't attach an `Authorization` header to the
> handshake — `@emito/js`'s WS transport authenticates via cookie in that case
> instead. If your `resolveSubscriberId` only checks the header (the default
> above), WS silently never authenticates in a browser — REST/SSE/polling
> still work, so this is easy to miss until live push (the bell badge, toasts)
> mysteriously never updates. Pass `cookieName` and set that same cookie
> server-side, alongside the token you hand to `EmitoProvider`:
> ```ts
> resolveSubscriberId: createJwtAuth({ hmacSecret: secret, cookieName: "emito_token" }),
> ```
> The header still takes priority when both are present.

## API surface

| Export | Kind | Description |
| --- | --- | --- |
| `signHS256(payload, secret)` | function | Signs a JSON `payload` as a compact HS256 JWT. Returns the token string. Does not inject time claims — set `iat`/`exp` yourself. |
| `verifyHS256(token, secret)` | function | Verifies a token: algorithm pin (`HS256`), timing-safe signature check, and `exp` expiry. Returns `{ header, payload }` or `null`. |
| `createJwtAuth(options)` | function | Builds a `ResolveSubscriberId` that authenticates `Bearer` tokens and returns the `subscriberId` claim. |
| `HS256Result` | type | `{ header: Record<string, unknown>; payload: Record<string, unknown> }`. |
| `JwtAuthOptions` | type | `{ hmacSecret: string; cookieName?: string }` — the HMAC-SHA256 secret, plus an optional cookie name to fall back to for browser WS auth. |
| `ResolveSubscriberId` | type | Re-exported from `@emito/types`: `(req: Request) => Promise<string \| null>`. |

## Part of Emito

`@emito/auth-jwt` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Shared types** — [`@emito/types`](../types/README.md)
- **HTTP server** — [`@emito/server`](../server/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
