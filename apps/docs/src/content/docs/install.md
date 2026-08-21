---
title: Install
description: Add the Emito packages to your backend and frontend.
---

```bash
npx @emito/cli@latest init
```

This detects your package manager and backend framework (Express, Fastify,
Hono, Next.js, or generic Node), installs the right `@emito/*` packages, runs
the schema migration, and generates `emito.config.ts` + `emito.mount.ts` for
you to mount in your entrypoint. Using an AI coding agent? Run
`npx @emito/cli@latest agent-skill` once, then just ask it to "install
Emito"; it runs the CLI and wires the mount call in for you, including the
frontend (React components, or a plain-JS bell/inbox/preferences UI if this
project has no React frontend).

Non-interactive / CI use: `emito init --yes` skips every prompt (in-app
channel only, auto-confirmed plan, auto-selected framework on unrecognized
stacks). Pre-supply choices instead of accepting the interactive defaults
with `--channels email,sms` and/or `--framework fastify`. `--yes` **requires
`DATABASE_URL` and `REDIS_URL` to already be set** in the environment it
runs in, because it skips the interactive prompt that would otherwise ask
for them. Point them at a real, reachable Postgres/Redis before running it,
or the migration step fails.

If `emito init` doesn't recognize your stack, skip it and add the packages
by hand instead:

```bash
npm install @emito/core @emito/server @emito/db @emito/auth-jwt @emito/provider-resend @emito/js ioredis   # backend
npm install @emito/react                                                                                    # React frontend only
```

Then follow [Migrate](/migrate/), [Configure](/configure/),
[Backend](/backend/), and [Frontend](/frontend/) by hand.

:::note[ioredis]
`ioredis` is a **direct** import in your own wiring code (`new Redis(...)`,
see [Backend](/backend/)): it's not enough that it resolves transitively
through `@emito/core`; a strict `node_modules` layout (pnpm's default, or
npm/Yarn under some configurations) won't let a bare `import "ioredis"`
resolve unless it's a direct dependency of your project too. The same is
true of `@emito/js`, which a plain-JS frontend imports directly even though
it's also a transitive dependency of `@emito/react`. `emito init` already
adds both for you; if you're installing by hand, add them alongside the
packages above.
:::

## Finish wiring it up (after `emito init`)

`emito init` generates two files but doesn't mount anything for you yet, so
three steps are left.

**1. Add two secrets to your `.env`.** `buildEmitoServer()` in the
generated `emito.mount.ts` refuses to start without both. `emito init`
already generated and printed both at the end of the install; paste them
as-is:

```bash
EMITO_JWT_SECRET=<value emito init printed at the end>
EMITO_API_KEY=<value emito init printed at the end>
```

They protect two different things. `EMITO_JWT_SECRET` is the HMAC key your
backend uses to sign a short-lived token identifying *which subscriber*
(end user) is calling; Emito verifies it on every request from the
frontend, so it knows whose inbox to show. `EMITO_API_KEY` gates a
separate, more privileged set of endpoints (checked against the
`x-emito-admin-key` header) meant for your own backend/admin tooling, not
the ordinary subscriber-facing frontend. Generate real, distinct secrets
per environment before production: the values above are for local dev only.

**2. Mount `mountEmito` in your entrypoint.** The generated
`emito.mount.ts` has the exact snippet in a comment at the top; for a
Fastify app it looks like:

```ts
import Fastify from "fastify";
import { buildEmitoServer, mountEmito } from "./emito.mount.js";

const app = Fastify();
const { server, emito, repositories, cleanup } = await buildEmitoServer();
mountEmito(app, server);
app.addHook("onClose", cleanup); // stops workers, disconnects Redis

await app.listen({ port: 3000 });
```

`emito` and `repositories` are the same runtime `server` was built from —
keep them around if you want to call `emito.send(...)` yourself, e.g. from a
one-off test route, rather than only through a real domain event later.

At boot, `buildEmitoServer()` prints two one-time warnings if you haven't
touched their defaults yet: a missing `cookieName` on `resolveSubscriberId`
(the WebSocket transport authenticates via cookie in a browser, and fails
closed with no other logging if it's absent; see [Gotchas](/gotchas/)),
and the default `resolveWorkspaceRole`, which locks Emito's admin API to
every subscriber until you replace it with your own auth/DB check (see
[Backend](/backend/#mount-the-server)).

**3. Restart your server and verify it's actually up:**

```bash
curl http://localhost:3000/emito/health
```

A healthy response looks like
`{"data":{"healthy":true,"providers":[...],"redis":{"healthy":true}}}`, with
one entry per configured channel (`inApp`, `email`, `sms`, ...), each with
its own `healthy` flag. This is the simplest end-to-end proof the install
actually worked, before wiring up any real frontend or domain events; see
[Backend](/backend/) and [Frontend](/frontend/) for the rest.

Want proof a notification actually gets delivered, not just that the server
is up? Call `emito.send(...)` from the handle `buildEmitoServer()` returned,
using the starter event `emito init` generated in `emito.config.ts`:

```ts
await repositories.subscriberRepository.upsert({ id: "test-user" });
await emito.send({ event: "welcome.sent", subscriberId: "test-user", payload: {} });
```

`payload` is required even when the event has no template variables — see
[Gotchas](/gotchas/).

> **Testing further by hand?** `/health` is one of a handful of paths that
> deliberately stay unversioned (see [API versioning](/backend/#api-versioning));
> everything else lives under `/v1`. `curl http://localhost:3000/emito/preferences`
> 404s with `ROUTE_NOT_FOUND`; the real path is
> `curl http://localhost:3000/emito/v1/preferences`. The client SDKs
> (`@emito/js`, `@emito/react`) already append `/v1` for you, so this only
> bites when curling the API directly.

:::caution[Ship built packages]
Install the **built** tarballs (`dist/`), not raw source. This only matters
if you ever swap in a hand-rolled or locally-built package instead of the
published one. A package that ships raw TypeScript source will crash a
compiled service at runtime with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
See the [gotchas checklist](/gotchas/) for the full list of sharp edges.
:::

Next: [Migrate the schema](/migrate/).
