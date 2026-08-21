---
title: Gotchas checklist
description: Save yourself a debugging round. The known sharp edges, in one place.
---

Read this before you debug something that's already a known sharp edge.

1. **Relative `endpoint` in the browser.** The client builds URLs with
   `new URL()`, which needs an absolute base. In a browser, a relative
   `endpoint` like `/emito` is now resolved against `window.location.origin`
   automatically. Outside a browser (SSR, Node, React Native) there's no page
   origin to resolve against, so `endpoint` must still be absolute there.
2. **`transport` per environment.** SSE flaps behind a dev proxy that doesn't
   handle long-lived connections well, so use `"polling"` locally in that
   case. In the browser, WebSocket can't send a Bearer header on the
   handshake, so the client falls back to cookie-based auth there; that only
   works if your server actually checks a cookie. `createJwtAuth` (from
   `@emito/auth-jwt`) only checks the `Authorization` header unless you pass
   `cookieName`; without it, WS silently never authenticates in a browser
   while REST/SSE/polling keep working, so this is easy to miss. Pass
   `cookieName` and set that same cookie server-side alongside the token you
   hand to `EmitoProvider`. See
   [`@emito/auth-jwt`'s README](https://github.com/emito-pro/emito/tree/main/packages/auth-jwt#readme).
   Inbox actions (mark-read/archive) only reach the server while the client
   reports *connected*, so a wedged transport leaves every action stuck in an
   offline queue.
3. **Preference `topicKey` = the EVENT NAME**, not the category. `GET
   /preferences` emits defaults per event name and the engine gates delivery
   by event name, so using a category name here silently breaks preference
   matching.
4. **Provider keys validate eagerly.** `createResendProvider` throws on an
   empty `apiKey` and crashes boot. Guard it (fall back to a mock provider)
   whenever the key is optional in your environment.
5. **`subscriberId` must match** between the token you mint server-side and
   the `subscriberId` prop passed to `EmitoProvider` client-side. A mismatch
   gets the client rejected.
6. **Email is Resend-only, for now.** There is no SMTP provider yet, and
   Resend requires a verified sending domain, so plan your `EMITO_EMAIL_FROM`
   address accordingly.
7. **Ship packages built, not raw source.** Vendor the compiled `dist/`
   tarballs. A tarball containing raw TypeScript source will crash a compiled
   service at runtime with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
8. **ESM only.** No `require()`; import-only, everywhere.
9. **Split send/serve pattern.** If a worker process calls `emito.send()`
   while a separate API process serves the inbox and realtime connections,
   the worker must also bridge realtime (wire `notification:created` into the
   API's connection registry) or notifications only land in the inbox DB and
   never push live.
10. **Name your Postgres role something other than `emito`, or force
    `search_path`.** Postgres resolves `"$user"` in `search_path` (default:
    `"$user", public`) to the connecting role's name. A role literally named
    `emito` collides with the `emito` schema `migrationsSchema: 'emito'`
    creates, so unqualified `CREATE TABLE` statements from the migration
    files land in `emito` instead of `public`, while their hardcoded FK
    references stay qualified to `public`; this produces `relation
    "public.emito_categories" does not exist`. See [Migrate](/migrate/) for
    the `SET search_path TO public` fix (run it before every `migrate()`
    call, regardless of the connecting role's name).
11. **Mounting on Express: restore `req.url`, don't just `emitRouter` +
    `app.use`.** Express strips the mount path from `req.url` for routes
    registered via `app.use(prefix, router)`, but `@emito/server`'s router
    matches against the full `/emito/*` path, so every route 404s unless you
    restore it. Use `toNodeHandler` (from `@emito/server/node`) directly and
    reassign `req.url = req.originalUrl` before calling it, rather than
    `emitRouter` + `app.use("/emito", router)`. `npx @emito/cli@latest init`
    generates the correct pattern automatically for Express; this only bites
    if you're wiring the Express adapter by hand.
12. **Mounting on Hono: use `mountHono`, not `app.route()`.** `mountHono`
    registers an absolute route (your `prefix` plus `/*`, e.g. `/emito/*`).
    Mounting a sub-app with `app.route('/emito', sub)` strips the base path
    before the handler sees it, so every `/emito/*` route 404s, exactly as
    with Express. Note also that WebSocket upgrades never reach a
    Hono handler: wire `createHonoWsHandler` on the Node server
    `@hono/node-server` returns, and on Bun/Deno/Workers use the SSE or
    polling transport instead.
13. **Manual `curl` testing needs the `/v1` prefix.** Most routes live under
    `{prefix}/v1/...`; only `/health`, `/metrics`, `/track/*`, `/unsubscribe`,
    and `/webhooks/:provider` deliberately stay unversioned (see
    [API versioning](/backend/#api-versioning)). `curl .../emito/preferences`
    404s with `ROUTE_NOT_FOUND`; the real path is `.../emito/v1/preferences`.
    The client SDKs already append `/v1` for you, so this only bites when
    curling the API directly for debugging.
14. **`/health` and `/metrics` have no auth by default.** Both assume
    network-level access control (a self-hosted deployment behind your own
    firewall/VPC), not application-level auth: the health payload includes
    provider names and Redis connectivity state. If you expose Emito's port
    directly to the internet, put a reverse-proxy rule or firewall ahead of
    these two paths.
15. **The generated `emito.mount.ts` warns at boot, not per request.** If you
    haven't set `cookieName` or replaced the default `resolveWorkspaceRole`,
    the generated server logs two `console.warn` lines once on startup
    (not on every request) so the defaults don't get lost in request-log
    noise. The second warning is a reminder, not a bug report: leaving
    `resolveWorkspaceRole` at its default is secure (every subscriber is
    treated as a plain member), but it also means the admin API stays locked
    until you wire up a real role check.
16. **`send()` throws `SUBSCRIBER_NOT_FOUND` unless you pass a recipient
    override.** If `subscriberId` isn't in the subscriber repository and the
    call includes no `recipient` overrides (email/phone/pushTokens), `send()`
    throws instead of silently no-oping. Passing `recipient` overrides for an
    unknown subscriber takes the other branch: it creates a minimal
    subscriber record from those overrides rather than throwing.
17. **`payload` is required, even with nothing to template.** `send()` throws
    `VALIDATION_ERROR` if `payload` is missing, `null`, or not an object.
    Pass `{}` for events with no template variables.

See [Add a notification](/add-a-notification/) for the fastest path once
everything above is wired up.
