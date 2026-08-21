<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/demo

  **A full-stack trading app wired to Emito, in one self-contained stack.**

  [![Internal package](https://img.shields.io/badge/package-internal-6E7681)](../../README.md)
  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
  ![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
  ![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
  ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
  ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
  ![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white)
  ![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
</div>

## What it is

`@emito/demo` is a runnable reference application — a small trading platform whose backend embeds Emito as an in-process library rather than calling a separate notification service. An Express server serves both the trading API and the Vite-built React frontend from a single port, and exposes the Emito HTTP + WebSocket API under `/emito`. Triggering an event in the trading UI runs the real send pipeline against a real PostgreSQL and Redis — preferences, consent, templating, delivery and the in-app inbox, not mock data.

> This is an internal workspace package (`"private": true`). It is not published to npm and is not meant to be installed as a dependency; it exists to exercise the full Emito stack end-to-end.

## Prerequisites

- Node.js >= 22
- pnpm
- Docker (for PostgreSQL + Redis)

## Run it — dev stack

```sh
# 1. Start PostgreSQL + Redis
docker compose -f apps/demo/docker-compose.yml up -d

# 2. Create your env file (defaults work out of the box)
cp apps/demo/.env.example apps/demo/.env

# 3. Install dependencies (from the repo root)
pnpm install

# 4. Build packages, run migrations, seed demo data
DATABASE_URL="postgres://emito:emito@localhost:5432/emito_demo" pnpm demo:init

# 5. Start the app
pnpm demo:start
```

Open http://localhost:3001. The Emito API is served at `/emito`.

## Run it — full stack (Docker)

The demo ships as one Docker stack. Migrations and the demo seed run automatically on boot, so there is nothing to bootstrap by hand.

```sh
# From the repo root — one command brings the whole platform online:
docker compose -f docker-compose.demo.yml up -d --build
```

| Service | URL |
|---------|-----|
| Trading app | http://localhost:3100 |
| PostgreSQL | `localhost:5434` (db `emito_demo`, user/pass `emito`/`emito`) |
| Redis | `localhost:6381` |

The host ports (3100 / 5434 / 6381) are deliberately offset from the dev stack (3001 / 5432 / 6379) so both can run side by side.

### Accounts

**Trading app** — pick a user to sign in (no password; demo-only JWT login):

| User | Role | Email |
|------|------|-------|
| Alice Chen | Trader | alice@demo.emito.dev |
| Bob Martinez | Trader | bob@demo.emito.dev |
| Charlie Park | Admin | charlie@demo.emito.dev |

> **Local demo only.** These accounts and every committed default below are demo values, not production secrets. All of them are env-overridable (see the reference below).

## Notification events

The trading app triggers four event types, each mapped to an Emito category with its own consent policy:

| Event | Category | Channels | Priority |
|-------|----------|----------|----------|
| `order.fill` | Trading (opt-out) | email, inApp, push | high |
| `price.alert` | Trading (opt-out) | inApp, push, sms | high |
| `security.alert` | Security (always) | email, inApp, push, sms | critical |
| `team.invite` | Social (opt-in) | email, inApp | low |

By default all channels use mock providers that log to the server console. To enable real email delivery, set `RESEND_API_KEY` and `RESEND_FROM` in `.env`.

## Pages

- **Login** — pick a demo user
- **Dashboard** — notification bell with live unread count and an inbox popover (mark-as-read / archive / snooze)
- **Portfolio** — trigger buttons for the four notification events
- **Settings** — per-topic, per-channel preference toggles with workspace mode

## Layout

| Path | Role |
|------|------|
| `server/index.ts` | Express app: Emito HTTP router, WebSocket upgrade, trigger API, dev/prod static serving |
| `server/emito-config.ts` | Emito initialization — repositories, providers, categories, events |
| `server/auth.ts` | JWT login, demo user map, subscriber resolver |
| `server/seed.ts` | Idempotent DB seed for the demo fixtures |
| `client/src/` | React SPA — pages, header (bell + inbox), `EmitoProvider`, auth/api helpers |

## Environment reference

All values have working local-demo defaults; override any of them for a real deployment.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://emito:emito@localhost:5432/emito_demo` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `PORT` | `3001` | Server port (published as host `3100` in the Docker stack) |
| `JWT_SECRET` | `demo-jwt-secret-change-in-production` | Trading-app login JWT signing secret |
| `EMITO_API_KEY` | `demo-api-key-change-in-production` | Emito server API key |
| `RUN_MIGRATIONS_ON_BOOT` | unset | Apply `@emito/db` migrations on boot when `true` (idempotent) |
| `SEED_ON_BOOT` | unset | Seed the demo fixtures on boot when `true` (idempotent) |
| `RESEND_API_KEY` / `RESEND_FROM` | — | Resend API key and sender address for real email |

## Part of Emito

`@emito/demo` is the reference app in the [Emito](../../README.md) monorepo — self-hosted, provider-agnostic notification infrastructure for Node.js and TypeScript.

- **Core engine** — [`@emito/core`](../../packages/core/README.md)
- **HTTP server** — [`@emito/server`](../../packages/server/README.md)
- **React hooks** — [`@emito/react-hooks`](../../packages/react-hooks/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
