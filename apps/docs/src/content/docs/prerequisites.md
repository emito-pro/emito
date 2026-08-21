---
title: Prerequisites
description: What needs to be running before you integrate Emito.
---

Before wiring Emito into your app, make sure you have:

- **PostgreSQL** and **Redis**: Emito uses its own `emito_`-prefixed tables
  and Redis for rate limiting, digests, and realtime fanout.
- **Node ≥ 22, ESM** (`"type": "module"` in your `package.json`). Emito's
  packages are ESM-only, with no `require()`.
- A backend framework with an adapter: **Fastify / Express / Next.js / Hono /
  generic Node** (`http.createServer`, which also covers WebSocket upgrade).
  `npx @emito/cli@latest init` detects all five automatically.
  :::note[Hono: WebSocket needs a Node server]
  The Hono adapter itself is runtime-agnostic (Node, Bun, Deno, Workers), but
  the WebSocket transport is not, because upgrades are wired on the Node
  server `@hono/node-server` returns. On Bun, Deno, and Workers use the SSE or
  polling transport instead.
  :::
- **React 18 or 19** for the prebuilt frontend components, which are optional. Go
  headless with `@emito/react-hooks` if you don't want the prebuilt UI, use
  `@emito/react-native` (React Native ≥0.72) for a mobile app, or skip React
  entirely: `@emito/js`'s framework-agnostic `EmitoClient` wires the same
  bell/inbox/preferences UI into a server-rendered or non-React frontend; see
  [Frontend](/frontend/).

Once these are in place, continue to [Install](/install/).
