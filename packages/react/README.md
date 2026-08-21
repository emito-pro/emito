<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/react

  **Drop-in React components for in-app notifications — bell, inbox, feed, toasts, and a preference center.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)
  ![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
</div>

## What it is

`@emito/react` is the prebuilt UI layer of Emito's React stack. It ships ready-to-use,
fully typed components — a `NotificationBell`, an `InboxPopover`, a `NotificationFeed`,
`Toast`, and a `PreferenceCenter` — built on top of the headless hooks in
[`@emito/react-hooks`](../react-hooks/README.md). Drop a provider near the root of your
app, render a component, and you have a live notification experience wired to your Emito
backend.

> The hooks do the data work (fetching, real-time transport, optimistic updates); this
> package supplies the styled, accessible widgets. Every component accepts per-slot
> `classNames` overrides and a CSS-variable theme, so you can match your product without
> forking markup.

## Install

Emito is developed as a pnpm workspace; the `@emito/*` packages are consumed
from within the monorepo. Add the component layer to a workspace package as a
workspace dependency:

```jsonc
// package.json
"dependencies": {
  "@emito/react": "workspace:*"
}
```

> Standalone npm publishing of the `@emito/*` scope is planned but not yet
> available — install from the workspace for now.

`react` and `react-dom` (`>=18`) are peer dependencies — bring your own.

## Usage

Wrap your app in `EmitoProvider`, then compose the bell and inbox. Import the
stylesheet once.

```tsx
import {
  EmitoProvider,
  NotificationBell,
  InboxPopover,
} from "@emito/react";
import "@emito/react/index.css";

function App() {
  return (
    <EmitoProvider
      endpoint="https://myapp.com/emito"
      subscriberId="user_123"
      token={jwtForCurrentUser}
    >
      <InboxPopover bell={<NotificationBell />} />
    </EmitoProvider>
  );
}
```

`EmitoProvider` forwards every `EmitoClient` option (`endpoint`, `subscriberId`, `token`,
`transport`, `wsEndpoint`, …). The `transport` defaults to `"auto"`, which probes the
server and picks WebSocket, SSE, or polling.

## API surface

The package re-exports the provider and hooks from `@emito/react-hooks` and adds the
component layer on top.

| Export | Kind | Purpose |
| --- | --- | --- |
| `EmitoProvider` | Provider | Configures the client and supplies context to all components. |
| `useEmitoClient` | Hook | Access the underlying `EmitoClient`. |
| `useNotifications` | Hook | Notification list with read/archive actions. |
| `useUnreadCount` | Hook | Live unread badge count. |
| `usePreferences` | Hook | Subscriber notification preferences. |
| `useToast` | Hook | Imperative toast queue. |
| `useClientEvent` | Hook | Subscribe to client lifecycle events. |
| `NotificationBell` | Component | Bell trigger with unread badge. |
| `InboxPopover` | Component | Floating inbox anchored to a trigger element. |
| `NotificationInbox` | Component | Inbox panel (list + header actions). |
| `NotificationFeed` | Component | Tabbed, full-page notification feed. |
| `NotificationItem` | Component | Single notification row. |
| `OverflowMenu` / `SnoozePicker` | Component | Per-item action menu and snooze picker. |
| `EmptyState` | Component | Empty-list placeholder. |
| `Toast` | Component | Transient toast notification. |
| `PreferenceCenter` | Component | Topic/channel preference management. |
| `PreferenceRow` / `PreferenceToggle` | Component | Building blocks for custom preference UIs. |
| `IntegrationManager` | Component | Manage subscriber channel integrations. |
| `EmitoThemeProvider` | Provider | Apply CSS-variable appearance and shared `classNames`. |
| `useThemeAppearance` / `useThemeClassNames` | Hook | Read the active theme context. |
| `appearanceToVars` | Util | Convert an `EmitoAppearance` into CSS variables. |
| `formatRelativeTime` | Util | Render relative timestamps (e.g. "2m ago"). |

Subpath stylesheet export: `@emito/react/index.css`. Type definitions ship for
every export.

## Part of Emito

`@emito/react` is one package in the [Emito](../../README.md) monorepo — self-hosted,
provider-agnostic notification infrastructure for Node.js and TypeScript.

- **Headless hooks** — [`@emito/react-hooks`](../react-hooks/README.md)
- **Client SDK** — [`@emito/js`](../js/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
