---
title: Frontend
description: Mount the Emito notification UI, with React components or plain JS.
---

This page covers two paths: `@emito/react`'s prebuilt components for a React
frontend, and `@emito/js`'s framework-agnostic `EmitoClient` for everything
else (a server-rendered app, a non-React SPA, or a generic Node frontend).
Both talk to the same backend mount. Pick the one matching this project's
stack, not both.

## React

```tsx
import '@emito/react/index.css';
import { EmitoProvider, NotificationBell, InboxPopover, PreferenceCenter } from '@emito/react';

const getToken = useRef(() => fetch('/emito/token', { method: 'POST' }).then(r => r.json()).then(d => d.token)).current;

<EmitoProvider
  endpoint="/emito"                               // relative is fine in the browser
  subscriberId={user.id}
  getToken={getToken}                            // stable ref
  transport="polling">                           // ⚠️ see gotchas
  <InboxPopover bell={<NotificationBell />} preferencesHref="/settings/notifications" />
</EmitoProvider>

// preferences page:
<PreferenceCenter topics={[{ topicKey: 'payout.settled', label: 'Payouts', category: 'transactional', channels: ['inApp','email'] }]} />
```

A few things that matter more than they look:

- **`endpoint` can be relative in the browser.** The client resolves a
  relative base like `/emito` against `window.location.origin`
  automatically. Outside a browser (SSR, Node, React Native) there's no page
  origin to resolve against, so pass an absolute URL there instead; see
  [Gotchas](/gotchas/).
- **`endpoint` is the mount path, without the API version.** Pass
  `.../emito`, not `.../emito/v1`, because the client appends the version it
  speaks and would otherwise request `/emito/v1/v1/...`. See
  [API versioning](/backend/#api-versioning).
- **`subscriberId` must match the token.** The `subscriberId` prop and the
  `subscriberId` embedded in the token minted by your `/emito/token` endpoint
  must be the same value, or the client will be rejected.
- **`getToken` must be a stable reference** (e.g. via `useRef` or
  `useCallback`): an unstable function identity causes the provider to
  re-negotiate the connection on every render.
- **`transport`**: use `"sse"` for realtime push in normal deployments. Behind
  a dev proxy that doesn't handle long-lived connections well, SSE can flap;
  fall back to `"polling"` locally. Browser WebSocket can't carry a Bearer
  header, so the client authenticates the WS handshake via cookie instead,
  which requires your `resolveSubscriberId` to check a cookie too (pass
  `cookieName` to `createJwtAuth`, from `@emito/auth-jwt`). See
  [Gotchas](/gotchas/) for the full rationale.

### Components

- **`InboxPopover`**: the notification feed UI, paired with a `bell` (e.g.
  `NotificationBell`) that shows unread count and opens the popover.
- **`NotificationBell`**: the bell icon and unread badge.
- **`PreferenceCenter`**: renders one row per `topic`. **`topicKey` is the
  EVENT NAME**, not the category, because `GET /preferences` emits defaults
  keyed by event name, and the engine gates delivery by event name.

## No React

`@emito/js` ships the same client the React package builds on
(`EmitoClient`) with no framework dependency; use it directly for a
server-rendered app (Express/Fastify/Hono templates, plain HTML) or any
non-React frontend. It's installed automatically by `emito init`.

```html
<script type="module">
  import { EmitoClient } from '@emito/js';

  const client = new EmitoClient({
    endpoint: '/emito',
    subscriberId: currentUserId,
    token: currentUserJwt, // or getToken: () => fetch('/emito/token', ...)
  });

  await client.connect();
  await client.fetchUnreadCount();
  document.querySelector('#emito-bell-count').textContent = client.getUnreadCount();

  client.on('notification', () => {
    document.querySelector('#emito-bell-count').textContent = client.getUnreadCount();
  });
</script>
```

Render a bell with an `#emito-bell-count` badge in the layout every
logged-in page shares, at the same placement as the React path, just
without a component library. From there:

- **Inbox**: list `client.getNotifications()` (or call
  `client.notifications.list()` directly), call `client.markAsRead(id)` on
  click.
- **Preferences**: render one toggle per `client.preferences.get()` entry,
  call `client.updatePreference({ topicKey, channel, enabled })` on change.
  Same `topicKey` = event name rule as `PreferenceCenter` above.

The `endpoint`/`subscriberId`/`transport`/`cookieName` notes above apply
here too: `EmitoClient` is what both paths are built on.

Next: [Translate the UI](/i18n/) (optional), or jump straight to the
[Gotchas checklist](/gotchas/).
