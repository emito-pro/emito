---
title: Deploy to Railway
description: Build and run Emito (and these docs) on Railway.
---

A walkthrough for deploying an Emito-backed app, and the notification
infrastructure it needs, on Railway. This assumes you've already gone
through [Install](/install/) → [Migrate](/migrate/) → [Configure](/configure/)
→ [Backend](/backend/) → [Frontend](/frontend/) locally; this page is only
about moving that same setup onto Railway.

## Provision Postgres and Redis

Add a **Postgres** and a **Redis** plugin to your Railway project (or
service group). Both expose a `DATABASE_URL`/`REDIS_URL`-style connection
variable; reference them into your app service with Railway's variable
references (e.g. `${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`) rather
than copy-pasting the values, so a plugin credential rotation doesn't require
a manual update.

## Run the migration as a one-shot step

Whichever image runs the migration (a **release command**, or a separate
one-shot **migrate service** if your deploy has one) must contain
`@emito/db`, because the migration SQL files ship inside that package, not as a
separate artifact. If you used `npx @emito/cli@latest init` locally, the
`emito.config.ts`/`emito.mount.ts` it generated already wire the runtime; the
migration itself still needs to run once against the Railway database before
(or as part of) your first deploy. See the [Migrate](/migrate/) page for the
exact snippet, and the [search_path gotcha](/gotchas/) if your Postgres role
happens to be named `emito` (Railway's default Postgres plugin role is not,
but a role you create yourself might be).

If you'd rather not hand-write a migration script, running `npx
@emito/cli@latest init` directly against the Railway database's connection
strings (from your local machine, with `DATABASE_URL`/`REDIS_URL` pointed at
the Railway plugins) runs the same migration and regenerates the glue files
in one step. That's useful for first-time setup, less useful for a repeatable
deploy pipeline, where a small migration script committed to your repo
(the [Migrate](/migrate/) snippet, wrapped in a one-shot entrypoint) is
easier to run unattended on every release.

## Required secrets

Set these as Railway service variables (not committed to `.env.example`):

- `EMITO_JWT_SECRET`: the HS256 signing secret `emito init` generates and
  prints once. A Railway environment needs its own value, not the one from
  your local `.env`.
- `EMITO_API_KEY`: the API key `createEmitoServer` validates on every admin
  request.
- Provider credentials for whichever channels you enabled: `RESEND_API_KEY`
  + `EMITO_EMAIL_FROM` (a verified sending domain) for email, an SMS
  provider's token for SMS. Omit a channel's credentials and Emito falls back
  to a mock provider that logs instead of sending, which is fine for a preview
  environment but not for production.

## Rolling out behind your own feature flag

If Emito is replacing an existing notification path (a strangler-pattern
migration, not a greenfield app), it's worth gating the new code behind your
own app-level flag. Emito itself has no such flag; this is something you
add in your own config (an env var your app reads, e.g. `EMITO_ENABLED`, and
a matching build-time flag for the frontend bundle if you're using a bundler
that inlines env vars at build time, e.g. `VITE_EMITO_ENABLED`). That lets
you deploy the wiring dark, verify it against production traffic, and flip
it on without a second deploy.

## Per-PR preview environments

If your Railway setup already creates a fresh environment per pull request
(forking from a base environment), Emito's Postgres/Redis needs land on that
same fork automatically as long as the preview environment inherits the base
environment's plugin references, so no Emito-specific configuration is needed
there. Just make sure the migration step (above) runs against each new
preview environment's database before the app boots, the same way it does
for your main environment.

## Deploying a Node app: pin the builder explicitly

Railway auto-detects how to build a service (Nixpacks, Dockerfile, etc.), and
for a monorepo app with a `Dockerfile` alongside other build tooling, that
detection can pick the wrong builder. Commit a `railway.json` at the app's
root to make the choice explicit instead of relying on auto-detection:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

This is exactly how this documentation site itself is deployed: a
`Dockerfile` builds the static Astro output, and a small Node server
(`server.mjs`) serves it. The server reads the port Railway assigns via
`process.env.PORT`, falling back to a default (`4321`) for local runs where
Railway hasn't injected one:

```js
const PORT = Number(process.env.PORT) || 4321;
```

Don't hardcode a port in your `Dockerfile`'s `EXPOSE` or in your app's
listener; Railway assigns the port dynamically per deploy, and your process
needs to bind to whatever `PORT` it's given, not a fixed value.
