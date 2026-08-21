---
title: Backend
description: Build the Emito runtime, mount the server, and wire the auth bridge.
---

## Build the runtime

```ts
import { createEmito, IoRedisAdapter, createMockProvider } from '@emito/core';
import { createEmitoServer } from '@emito/server';
import { createFastifyPlugin } from '@emito/server/fastify';
import { createJwtAuth, signHS256 } from '@emito/auth-jwt';
import { createResendProvider } from '@emito/provider-resend';
import { createDrizzleClient, /* Drizzle*Repository */ } from '@emito/db';
import Redis from 'ioredis';

const db = createDrizzleClient(process.env.DATABASE_URL!);
const redisClient = new IoRedisAdapter(new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }));

// Build the repositories bundle from @emito/db's Drizzle*Repository classes
// (subscriber, notification, preference, workspaceDefault, suppression,
//  deadLetter, integration, inbox, consent, subscription, pushToken).
const repositories = { /* new DrizzleXRepository(db), ... */ };

const emito = createEmito({
  database: { url: process.env.DATABASE_URL! },
  redis: { url: process.env.REDIS_URL! },
  redisClient,
  repositories,
  templateResolver,
  categories,
  events,
  channels: {
    inApp: { providers: [createMockProvider('inApp', { name: 'inapp' })] }, // inbox
    // Guard the provider key: createResendProvider throws on an empty apiKey.
    email: process.env.RESEND_API_KEY
      ? { providers: [createResendProvider({ apiKey: process.env.RESEND_API_KEY, fromAddress: process.env.EMITO_EMAIL_FROM! })] }
      : { providers: [createMockProvider('email', { name: 'email-noop' })] },
  },
});
await emito.start();
```

`createResendProvider` validates its `apiKey` eagerly and **throws on an
empty string**. If the key is optional in your environment (e.g. local dev),
guard it and fall back to a mock provider, as shown above.

## Mount the server

```ts
const server = createEmitoServer({
  emito, apiKey: process.env.EMITO_API_KEY!, prefix: '/emito',
  repositories, redisClient,
  resolveSubscriberId: createJwtAuth({ hmacSecret: process.env.EMITO_JWT_SECRET! }),
  // Optional, but omitting it makes workspace-scoped admin endpoints return
  // "resolveWorkspaceRole not configured". `emito init` generates a secure
  // default that treats every authenticated subscriber as a workspace
  // *member*, locking the admin API (cross-workspace reads, subscriber
  // erase, broadcasts, dead-letters). Replace it with a real check against
  // your own auth/DB to expose those endpoints to actual admins.
  resolveWorkspaceRole: async () => 'member',
});
app.register(createFastifyPlugin(server));   // mounts /emito (REST + realtime)
```

`buildEmitoServer()` in the generated `emito.mount.ts` prints two one-time
`console.warn` calls at boot, one for each default above: a missing
`cookieName` (see the note just below), and this `resolveWorkspaceRole`
default. Both warnings are unconditional in the generated file, so if you
replace a default, delete its matching `console.warn` line too, or it keeps
firing even after you've fixed the thing it's warning about. Neither warning
is an error; each is a reminder that these are permissive-by-omission, not
permissive-by-mistake.

> `createJwtAuth({ hmacSecret })` alone only checks the `Authorization` header.
> If your frontend uses the WebSocket transport in a browser, also pass
> `cookieName` (e.g. `createJwtAuth({ hmacSecret, cookieName: 'emito_token' })`)
> and set that same cookie server-side, alongside the token you hand to
> `EmitoProvider`. A browser's `WebSocket` constructor can't attach an
> `Authorization` header, so the client authenticates the handshake via
> cookie instead. Without it, WS silently never authenticates while REST/SSE/polling
> keep working. See [Gotchas](/gotchas/).

`createFastifyPlugin` is the Fastify adapter; equivalent adapters exist for
Express, Next.js, Hono, and generic Node (`http.createServer`). See
[Prerequisites](/prerequisites/) for the full, current list. This mounts both
the REST API and the realtime transport under the given `prefix`.

On Hono, `mountHono` registers the API on the app you pass in, and the
WebSocket upgrade is attached to the Node server rather than the Hono app,
because upgrades are an HTTP-server event and never reach a route handler:

```ts
import { serve } from '@hono/node-server';
import { createHonoWsHandler, mountHono } from '@emito/server/hono';

mountHono(app, server);                                     // REST, under `prefix`
const httpServer = serve({ fetch: app.fetch, port: 3000 });
httpServer.on('upgrade', createHonoWsHandler(server));      // realtime (Node only)
```

## API versioning

`prefix` says *where* Emito is mounted. The API version is separate, and
Emito inserts it for you: every wire endpoint lives under
`{prefix}/v1/...`, so the defaults above serve
`/emito/v1/notifications`, `/emito/v1/preferences`, and so on. A custom
`prefix: '/api/notifications'` yields `/api/notifications/v1/...`: the
version is a property of the API, not of how you mounted it.

You rarely type this yourself. `@emito/js` (and the React packages on top of
it) append the version they speak, so you configure the mount path and
nothing else:

```ts
// endpoint = where you mounted Emito. Do NOT add /v1; the client does that.
<EmitoProvider endpoint={`${window.location.origin}/emito`} … />
```

Upgrading the package is what moves you to a new version. If you call the API
directly instead (from another language, a mobile client, curl), you write the
version yourself:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/emito/v1/notifications
```

### What stays unversioned

A few paths sit directly under the prefix, with no version segment:

| Path | Why |
| --- | --- |
| `/health`, `/metrics` | Operational probes: a version bump must not force a change to your k8s probes or Prometheus scrape config. |
| `/track/open/:id`, `/track/click/:id/:idx` | Baked into already-delivered email. These URLs sit in inboxes for years. |
| `/unsubscribe`, `/confirm` | Linked from delivered email, and HTML pages rather than a wire contract. |
| `/webhooks/:provider` | Inbound from Resend/Twilio/etc. The URL lives in the provider's console and the payload contract is theirs, not ours. |

Versioning those would pin every past version open forever, which is the
opposite of what a version segment is for.

### What a version bump means

`v1` changes only on a **breaking** change to the wire contract: a removed
field, a changed type, a moved path. Additive changes, such as a new endpoint
or a new optional field, ship within `v1`.

Emito is still `0.x`, so read that as an intention rather than a commitment:
while the packages are pre-1.0, a breaking change to the wire contract bumps the
minor package version and stays under `/v1`. From `1.0.0` on it becomes a real
guarantee, since the `@emito/*` packages follow SemVer, and a breaking wire change
then means both a new path segment (`/v2`) and a new major package version.

Two versions therefore move independently, and it is worth keeping them
straight: the **package** version tracks everything Emito ships (the TypeScript
API, the React components, the CLI), while the **API** version tracks only the
HTTP wire contract. A `0.2.0` release can add endpoints under `/v1`, and, while
Emito is pre-1.0, change them; only a post-1.0 major could introduce `/v2`. Pin
your `@emito/*` versions and read
[the changelog](https://github.com/emito-pro/emito/blob/main/CHANGELOG.md)
before every upgrade while Emito is `0.x`.

## The auth bridge

Emito doesn't know about your users, so you bridge your own auth into it by
minting a short-lived token that carries a `subscriberId`:

```ts
// Token endpoint: bridge YOUR auth to Emito. subscriberId = your stable user id.
app.post('/emito/token', { preHandler: [app.yourAuth] }, async (req) => {
  const id = req.user.id;
  await repositories.subscriberRepository.upsert({ id, email: req.user.email, lang: 'en' });
  return { token: signHS256({ subscriberId: id, exp: Math.floor(Date.now()/1000) + 900 }, process.env.EMITO_JWT_SECRET!) };
});
```

Upsert the subscriber record first (so preferences/inbox rows have somewhere
to attach to), then sign a token with the same `subscriberId` the frontend
will present.

## Sending

Wherever your domain events happen:

```ts
await emito.send({ event: 'payout.settled', subscriberId, payload: { amount: '100 zł' } });
```

`send()` looks up `subscriberId` via `subscriberRepository` (unless you pass
a `recipient` override) and throws `SUBSCRIBER_NOT_FOUND` if no such
subscriber exists yet. Seed or upsert the subscriber first (see
[the auth bridge](#the-auth-bridge) above), or your first test send in a new
environment fails here, before it ever reaches a provider.

:::caution[Split send/serve pattern]
If a separate process (e.g. a background worker) calls `emito.send()`
while a different process (your API) serves the inbox and realtime
connections, **the worker must also bridge realtime**: wire the worker's
`notification:created` event into the same connection registry the API uses
to push to connected clients. Skip this and notifications still land
correctly in the inbox DB, but they never push live; subscribers only see
them after a manual refresh or reconnect.
:::

Next: [Frontend](/frontend/).
