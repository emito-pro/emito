---
title: Categories & preferences
description: How opt-in policy and per-user channel preferences gate delivery.
---

**Categories** set the opt-in policy for a group of events (`always`, `opt_out`, `opt_in`); the **preference center** lets each subscriber toggle channels per event within those rules.

## Category policies

Every category declares one policy, and every event belongs to exactly one category:

- **`always`**: the subscriber cannot opt out (e.g. security alerts, payment failures). The `PreferenceCenter` UI renders this row locked, with no toggle.
- **`opt_out`**: on by default; the subscriber can turn it off per channel. Most product notifications land here.
- **`opt_in`**: off by default until the subscriber explicitly turns it on (e.g. marketing). Nothing is sent until they do.

## Preferences and the `PreferenceCenter` component

`PreferenceCenter` renders one row per **topic** you pass it, each keyed by `topicKey`. This is the single most important rule in this page:

:::caution[`topicKey` must be the event name]
`GET /preferences` returns defaults keyed by **event name**, and the delivery engine gates on preferences keyed by **event name**, not by category name. Passing a category name as `topicKey` silently breaks matching: the toggle renders, but flipping it does nothing, because the engine is checking a different key than the one the UI just wrote. See the [Gotchas checklist](/gotchas/) for this same rule stated as a numbered gotcha.
:::

## How delivery is gated

For every event Emito is about to deliver, on every channel that event declares, the engine checks: does this subscriber have a stored preference for this event+channel? If yes, honor it. If no (meaning this is an event the subscriber has never explicitly seen a toggle for), the category's policy default applies (`always` → deliver, `opt_out` → deliver, `opt_in` → don't deliver until they opt in). Once a subscriber sets an explicit preference, that stored value wins over the category default from then on.
