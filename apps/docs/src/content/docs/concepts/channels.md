---
title: Channels & providers
description: The delivery channels Emito supports and the provider adapters behind them.
---

Each notification event fans out to one or more **channels** (in-app, email, SMS, push, chat). A channel is backed by one or more **provider adapters** that do the actual delivery.

## The channels

- **`inApp`**: the notification inbox itself (`InboxPopover`/`NotificationBell`). It's always available since there's no external provider to configure; delivery just means "write a row the frontend can poll/stream."
- **`email`**: via `@emito/provider-resend` (Resend is the only email provider today; see the [Gotchas checklist](/gotchas/) for why, and its eager-validation behavior).
- **`sms`**: via `@emito/provider-twilio` or `@emito/provider-smsapi`.
- **`push`**: via `@emito/provider-fcm` (Firebase Cloud Messaging).
- **`slack`**: via `@emito/provider-slack`.
- **`telegram`**: via `@emito/provider-telegram`.

`createMockProvider(channel, opts)` exists for every channel. It logs to the console instead of sending, and is what you get automatically (via `npx @emito/cli@latest init`) for any channel you didn't configure real credentials for, so local development never accidentally sends real email/SMS/push/chat messages.

`@emito/types`' `Channel` type also reserves `webhook`, `discord`, `whatsapp`, and `webPush` for future provider packages. No adapter ships for these yet, so don't configure them.

## Provider health, rate limits, and the circuit breaker

Every provider call goes through the same resilience layer regardless of channel:

- **Retries**: up to 3 attempts by default, exponential backoff with jitter, and only for errors classified as transient (a permanent error like an invalid address is never retried).
- **Circuit breaker**: a Redis-backed, per-provider 3-state breaker (closed → open → half-open). Five consecutive failures trips a provider open for 30 seconds (skipped entirely, no wasted calls); one probe request during that window decides whether it closes again or stays open. If Redis itself is unreachable, the breaker fails open, so providers are treated as healthy rather than blocking delivery on a Redis outage.

## Writing a custom provider

A provider is any object implementing the `ProviderPlugin` contract:

- **`name: string`**: a unique identifier for the provider (e.g. `"resend"`, `"twilio"`).
- **`channel: Channel`**: which channel this provider delivers for (e.g. `"email"`, `"sms"`).
- **`deliver(params: ChannelDeliveryParams): Promise<DeliveryResult>`**: send the actual message.
- **`healthCheck(): Promise<boolean>`**: a cheap, no-side-effect check the `{prefix}/health` endpoint can call.

Register it the same way as a built-in provider: add it to that channel's `providers` array in your `emito.config.ts`. There's no separate registration mechanism or plugin system to learn beyond implementing this one interface.
