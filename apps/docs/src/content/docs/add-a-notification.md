---
title: Add a notification
description: The whole thing, in 3 lines, to add a new notification type.
---

Once the [backend](/backend/) and [frontend](/frontend/) are wired up, adding
a brand new notification type is three steps:

```ts
// 1) one event entry, in emito.config.ts's `events`:
events['pickup.reminder'] = { category: 'updates', channels: ['inApp'], priority: 'high' };

// 2) one template case in the resolver, also in emito.config.ts:
if (event === 'pickup.reminder' && channel === 'inApp')
  return { subject: 'Pickup reminder', body: `Your pickup is on ${payload.date}.` };

// 3) send it, from wherever the actual event happens in your app:
await emito.send({ event: 'pickup.reminder', subscriberId, payload: { date } });
```

Steps 1 and 2 are edits to `emito.config.ts` (restart to pick them up) — the
event registry is built once from that file when `createEmitoRuntime()`
runs, not read live, so mutating `events` after startup has no effect. Step
3 is the one that runs at request time, anywhere in your app.

That's it: it renders in the inbox immediately, and shows up in the
preference center automatically (keyed by `topicKey: 'pickup.reminder'`,
under the `updates` category's opt-out default).

`subscriberId` must already exist, because `send()` throws
`SUBSCRIBER_NOT_FOUND` otherwise. See [the auth bridge](/backend/#the-auth-bridge)
for where subscribers get created.
