---
title: Subscribers & tokens
description: Who receives notifications, and how your app authenticates them to Emito.
---

A **subscriber** is the identity a notification is delivered to, usually one of your users. Your app upserts subscribers and mints short-lived JWTs so the frontend can talk to Emito on their behalf.

## The subscriber model

A subscriber record (`CreateSubscriberData`) is intentionally small:

- **`id`**: your stable user id. This is the one field every other piece of Emito keys off of (the inbox, preferences, the token you mint), so it must never change for a given user.
- **`email`**, **`phone`**: optional, used by the email/SMS channels.
- **`lang`**, **`locale`**, **`timezone`**: optional, used by the template resolver and formatters.
- **`metadata`**: an open `Record<string, unknown>` for anything else your templates need.

You upsert a subscriber (`subscriberRepository.upsert(data)`) whenever you have fresh contact details for them, typically right before minting their token (see below), and again whenever their email/phone/locale changes in your own system. Upsert is idempotent: calling it again with the same `id` updates the existing row rather than erroring.

Because `send()` resolves `subscriberId` against this same repository, calling it for an id that was never upserted throws `SUBSCRIBER_NOT_FOUND` (unless you pass a `recipient` override). See [Backend](/backend/) for how that fits into the send flow.

## The auth bridge

Emito never owns your users; it authenticates them entirely through a bridge you control:

1. Your frontend calls your own `POST /emito/token` endpoint (not an Emito endpoint; you write this).
2. That endpoint authenticates the request with **your existing auth** (however your app already does it), extracts your stable user id, and mints a short-lived HS256 JWT with `signHS256({ subscriberId }, EMITO_JWT_SECRET)`.
3. The frontend passes that token to `EmitoProvider`'s `getToken` prop; Emito's server verifies it via `resolveSubscriberId` on every request.

The token is deliberately short-lived (minutes, not days): it's a bearer credential scoped to reading/writing one subscriber's own inbox and preferences, re-minted on demand rather than cached long-term. See [Backend](/backend/) for the full code for both sides of this bridge.

## Multi-member notes

Emito has no built-in concept of "team" or "workspace membership" beyond the `subscriberId` you choose to mint a token for. If several people share access to one account in your app (e.g. a team plan), each person who should get their own inbox needs their own subscriber id and their own token, because minting one shared token for a whole team means only whoever's `subscriberId` you picked receives anything.
