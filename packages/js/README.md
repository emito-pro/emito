<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/js

  **JavaScript/TypeScript client for the Emito notification server — real-time delivery over WebSocket, SSE, or polling, with optimistic state and an offline queue.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
</div>

## What it is

`@emito/js` is the platform-agnostic client SDK for Emito. It connects a browser
or Node.js application to an Emito server, streams notification events in
real time, and exposes typed REST helpers for notifications, preferences,
personal integrations, and marketing-list subscriptions. The `EmitoClient`
maintains a local notification store, applies optimistic updates, and queues
actions while offline so they replay on reconnect.

> The client picks the best available transport automatically — it probes the
> server's `/capabilities` endpoint and falls back from WebSocket to SSE to
> polling, so consumers don't hard-code a transport their deployment can't serve.

This package is the foundation the higher-level React layers build on
(`@emito/react-hooks`, `@emito/react`, `@emito/react-native`).

## Install

```bash
npm install @emito/js
```

Working inside the Emito monorepo instead? Use the workspace protocol:

```jsonc
// package.json
{
  "dependencies": {
    "@emito/js": "workspace:*"
  }
}
```

Its only runtime dependency is `@emito/types`, the shared type layer. TypeScript
declarations ship with the package — no separate `@types` install is needed.

## Usage

```ts
import { EmitoClient } from "@emito/js";

const client = new EmitoClient({
  endpoint: "https://myapp.com/emito",
  subscriberId: "user_123",
  token: "jwt_token",
  // transport defaults to "auto" (ws → sse → polling)
});

client.on("notification", (event, streamId) => {
  console.log(event.notificationId, event.body);
});

client.on("connected", () => console.log("connected"));
client.on("error", (err) => console.error(err));

await client.connect();

// Hydrate local state from the REST API
await client.fetchNotifications();
await client.fetchUnreadCount();

console.log(client.getUnreadCount(), client.getNotifications());

// Optimistic action — state updates immediately, reverts on server error,
// and queues for replay if currently offline
await client.markAsRead("ntf_abc");
```

The `EmitoClient` is an event emitter. Its event map (`EmitoClientEventMap`)
includes `connected`, `disconnected`, `error`, `notification`, `notifications`,
`unreadCount`, `snoozed`, and `queueError`.

## API surface

The package exposes a single entry point (`@emito/js`).

| Export | Kind | Purpose |
| --- | --- | --- |
| `EmitoClient` | class | Main client: connect, real-time events, optimistic actions, offline queue. |
| `TypedEmitter` | class | Strongly-typed event emitter that `EmitoClient` extends. |
| `TransportManager` | class | Probes capabilities and constructs the active transport. |
| `WebSocketAdapter`, `SSEAdapter`, `PollingAdapter` | class | Individual transport implementations of `TransportAdapter`. |
| `HttpClient` | class | Low-level fetch wrapper for the REST endpoints. |
| `NotificationsApi` | class | `list`, `unreadCount`, `markAsRead`, `markAsUnread`, `archive`, `unarchive`, `snooze`, `markAllAsRead`. |
| `PreferencesApi` | class | `get`, `update`, `reset`, `getForWorkspace`, `updateForWorkspace`. |
| `IntegrationsApi` | class | `list`, `create`, `update`, `deactivate` for personal integrations. |
| `SubscriptionsApi` | class | `list`, `subscribe`, `unsubscribe` for marketing-list subscriptions. |
| `NotificationStore` | class | In-memory notification list and unread-count state. |
| `OptimisticUpdater` | class | Applies and reverts optimistic mutations against the store. |
| `ActionQueue` | class | Persistable offline queue that replays actions on reconnect. |
| `MemoryStorageAdapter`, `IndexedDBStorageAdapter` | class | `StorageAdapter` implementations for queue persistence. |

Public types are also exported, including `EmitoClientOptions`, `TransportType`,
`TransportAdapter`, `StorageAdapter`, `NotificationItem`, `Integration`,
`Subscription`, and `QueuedAction`. See `src/index.ts` for the full list.

### Client options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `endpoint` | `string` | — | Base server URL, e.g. `https://myapp.com/emito`. |
| `subscriberId` | `string` | — | Identifier of the subscriber to connect as. |
| `token` | `string` | — | JWT auth token. |
| `transport` | `TransportType \| "auto"` | `"auto"` | `"ws"`, `"sse"`, `"polling"`, or auto-selection. |
| `storage` | `StorageAdapter` | — | Persists the offline queue across sessions. |
| `maxQueueSize` | `number` | `100` | Oldest queued actions are dropped when full. |
| `wsAuth` | `"cookie" \| "header"` | auto | WebSocket auth mode; `"cookie"` for browsers, `"header"` for Node/RN. |
| `wsEndpoint` | `string` | derived | Explicit WebSocket URL, overriding derivation from `endpoint`. |

## Part of Emito

`@emito/js` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Shared types** — [`@emito/types`](../types/README.md)
- **HTTP server** — [`@emito/server`](../server/README.md)
- **React hooks** — [`@emito/react-hooks`](../react-hooks/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
