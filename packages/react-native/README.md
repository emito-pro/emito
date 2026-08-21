<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/react-native

  **React Native bindings for Emito — notification hooks plus device push-token registration.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
</div>

## What it is

`@emito/react-native` is the React Native entry point for the Emito client SDK. It
re-exports the full notification hook surface from [`@emito/react-hooks`](../react-hooks/README.md)
— provider, client access, notification feed, unread count, preferences, and toasts —
and adds one React Native specific hook, `usePushToken`, that registers a device's
FCM or APNs push token with the Emito server.

> The package is a thin, platform-specific layer: everything except `usePushToken`
> is the same hook API used on the web, so a single mental model carries across both
> React and React Native apps.

## Install

Emito is developed as a pnpm workspace; the `@emito/*` packages are consumed
from within the monorepo. Add the React Native bindings (and the client
packages) to a workspace package as workspace dependencies:

```jsonc
// package.json
"dependencies": {
  "@emito/react-native": "workspace:*",
  "@emito/js": "workspace:*",
  "@emito/react-hooks": "workspace:*"
}
```

> Standalone npm publishing of the `@emito/*` scope is planned but not yet
> available — install from the workspace for now.

It declares the following peer dependencies, which your app must provide:

| Peer | Range |
|------|-------|
| `react` | `>=18` |
| `react-native` | `>=0.72` |
| `@emito/js` | `*` |
| `@emito/react-hooks` | `*` |

## Usage

Wrap your app in `EmitoProvider`, then register the device push token. `usePushToken`
auto-registers on mount and re-registers when the token changes.

```tsx
import { EmitoProvider, usePushToken, useUnreadCount } from "@emito/react-native";
import messaging from "@react-native-firebase/messaging";
import { Text } from "react-native";

function PushRegistration() {
  // Resolve the token asynchronously, then register it with the Emito server.
  const { token, isRegistering, error } = usePushToken({
    platform: "fcm",
    getToken: () => messaging().getToken(),
  });

  if (error) return <Text>Push registration failed: {error.message}</Text>;
  if (isRegistering || !token) return <Text>Registering for push…</Text>;
  return <Text>Registered</Text>;
}

function Badge() {
  const { count } = useUnreadCount();
  return <Text>{count} unread</Text>;
}

export default function App() {
  return (
    <EmitoProvider endpoint="https://emito.example.com" subscriberId="user_123" token="<jwt>">
      <PushRegistration />
      <Badge />
    </EmitoProvider>
  );
}
```

For manual control, pass `autoRegister: false` and call the returned `register()`
yourself:

```tsx
const { register, isRegistering } = usePushToken({
  platform: "apns",
  token: deviceToken, // a static token string
  autoRegister: false,
});

// later, e.g. after the user grants permission
await register();
```

## API surface

### `usePushToken(options)`

Registers a device push token with the Emito server through the active `EmitoClient`.

| Option | Type | Description |
|--------|------|-------------|
| `platform` | `"fcm" \| "apns"` | Push platform. Required. |
| `token` | `string` | Static push token string. |
| `getToken` | `() => Promise<string>` | Async resolver called on mount when no static `token` is given. |
| `autoRegister` | `boolean` | Register automatically on mount and when the token changes. Defaults to `true`. |

Returns:

| Field | Type | Description |
|-------|------|-------------|
| `token` | `string \| null` | The resolved push token, or `null` until resolved. |
| `isRegistering` | `boolean` | Whether registration is in progress. |
| `error` | `Error \| null` | Token-resolution or registration error. |
| `register` | `() => Promise<void>` | Manual registration trigger. |

### Re-exported from `@emito/react-hooks`

| Export | Kind |
|--------|------|
| `EmitoProvider` | Context provider that creates and manages the `EmitoClient`. |
| `useEmitoClient` | Access the active `EmitoClient` instance. |
| `useNotifications` | Notification feed for the current subscriber. |
| `useUnreadCount` | Live unread-notification count. |
| `usePreferences` | Read and update subscriber notification preferences. |
| `useToast` | In-app toast queue. |

Accompanying types are also re-exported: `PushPlatform`, `UsePushTokenOptions`,
`UsePushTokenResult`, `EmitoProviderProps`, `UseNotificationsParams`,
`UseNotificationsResult`, `UseUnreadCountResult`, `UsePreferencesOptions`,
`UsePreferencesResult`, `ToastItem`, `UseToastOptions`, and `UseToastResult`.

## Part of Emito

`@emito/react-native` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Shared hooks** — [`@emito/react-hooks`](../react-hooks/README.md)
- **Client SDK** — [`@emito/js`](../js/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
