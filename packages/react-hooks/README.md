<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/react-hooks

  **React hooks for the Emito notification client.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
</div>

## What it is

`@emito/react-hooks` is a thin, headless React layer over [`@emito/js`](../js/README.md), the
browser notification client. It wraps a single `EmitoClient` instance in a React context and exposes
hooks for the in-app inbox: listing notifications, tracking the unread count, managing subscriber
preferences, and surfacing real-time toasts. The hooks keep their state in sync with the client's
live WebSocket events, applying optimistic updates for read/archive/snooze actions.

> The package ships no UI. It manages client lifecycle and state so you can render notifications
> however your application needs.

## Install

Emito is developed as a pnpm workspace; the `@emito/*` packages are consumed
from within the monorepo. Add the hooks (and the browser client) to a workspace
package as workspace dependencies:

```jsonc
// package.json
"dependencies": {
  "@emito/react-hooks": "workspace:*",
  "@emito/js": "workspace:*"
}
```

> Standalone npm publishing of the `@emito/*` scope is planned but not yet
> available — install from the workspace for now.

`react` (`>=18`) is a peer dependency and is expected to already be present in your application.

## Usage

Wrap your tree in `EmitoProvider` once, then call the hooks anywhere beneath it.

```tsx
import {
  EmitoProvider,
  useNotifications,
  useUnreadCount,
} from "@emito/react-hooks";

function App() {
  return (
    <EmitoProvider
      endpoint="https://notifications.example.com"
      subscriberId="user_123"
      token="<subscriber-token>"
    >
      <Inbox />
    </EmitoProvider>
  );
}

function Inbox() {
  const { unreadCount } = useUnreadCount();
  const { notifications, isLoading, hasMore, fetchMore, markAsRead } =
    useNotifications({ limit: 20 });

  if (isLoading) return <p>Loading…</p>;

  return (
    <div>
      <h2>Inbox ({unreadCount} unread)</h2>
      <ul>
        {notifications.map((n) => (
          <li key={n.id} onClick={() => markAsRead(n.id)}>
            {n.subject ?? n.body}
          </li>
        ))}
      </ul>
      {hasMore && <button onClick={fetchMore}>Load more</button>}
    </div>
  );
}
```

`EmitoProvider` accepts the same options as [`EmitoClient`](../js/README.md) (`endpoint`,
`subscriberId`, `token`, and any other `EmitoClientOptions`). It connects on mount, disconnects on
unmount, and recreates the client when `endpoint`, `subscriberId`, or `token` change.

## API surface

The package has a single entry point (`@emito/react-hooks`).

| Export | Kind | Description |
| --- | --- | --- |
| `EmitoProvider` | Component | Context provider that creates and manages an `EmitoClient`. Accepts `EmitoProviderProps` (all `EmitoClientOptions` plus `children`). |
| `useEmitoClient` | Hook | Returns the raw `EmitoClient` from the nearest provider. Throws if used outside an `EmitoProvider`. |
| `useNotifications` | Hook | Lists notifications with cursor pagination and exposes `markAsRead`, `markAsUnread`, `markAllAsRead`, `archive`, `snooze`, `fetchMore`. New real-time notifications matching the active filters are prepended automatically. |
| `useUnreadCount` | Hook | Tracks the subscriber's unread count, kept current via real-time events. |
| `usePreferences` | Hook | Reads and mutates subscriber notification preferences, with optional `workspaceId` scoping. Exposes `updatePreference` and `resetPreferences`. |
| `useToast` | Hook | Collects incoming real-time notifications into an auto-dismissing toast queue. Exposes `add`, `dismiss`, `clear` and accepts `duration` / `maxSize` options. |
| `useClientEvent` | Hook | Subscribes to an arbitrary `EmitoClient` event with automatic cleanup on unmount. |

Each hook ships its accompanying types — `UseNotificationsParams`, `UseNotificationsResult`,
`UseUnreadCountResult`, `UsePreferencesOptions`, `UsePreferencesResult`, `ToastItem`,
`UseToastOptions`, `UseToastResult`, and `EmitoProviderProps`.

## Part of Emito

`@emito/react-hooks` is one package in the [Emito](../../README.md) monorepo — self-hosted,
provider-agnostic notification infrastructure for Node.js and TypeScript.

- **Browser client** — [`@emito/js`](../js/README.md)
- **Shared types** — [`@emito/types`](../types/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
