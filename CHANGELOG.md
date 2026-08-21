# Changelog

All notable changes to Emito are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every `@emito/*` package in this monorepo is released together under a single
version, so one entry per release covers the whole platform; the package a change
belongs to is named in the entry.

## [Unreleased]

<!--
Add user-visible changes here as part of the PR that makes them, under the
relevant heading (Added / Changed / Deprecated / Removed / Fixed / Security).
Name the package: "**@emito/core** — …". Internal refactors, test-only changes,
and dependency bumps don't need an entry.
-->

### Added

- **@emito/provider-kit** — new package with the machinery every provider
  repeats: `defineProvider` (config validation, per-channel params narrowing,
  error-context construction, and the terminal catch that guarantees callers see
  an `EmitoError`), error classification helpers (`deliveryError`,
  `httpDeliveryError`, `classifyHttpStatus`), `providerFetch` with a request
  deadline, and `@emito/provider-kit/testing` fixtures. The kit is optional —
  `ProviderPlugin` from `@emito/types` remains the contract, and a hand-written
  provider is indistinguishable to the engine. Its only dependency is
  `@emito/types`, so providers stay independently installable.
- **@emito/provider-slack**, **@emito/provider-telegram** — `createSlackProvider`
  and `createTelegramProvider` accept `timeoutMs` alongside `fetchFn`.

### Changed

- **@emito/provider-slack**, **@emito/provider-telegram**, **@emito/provider-smsapi**
  — outbound HTTP requests now carry a 10 second deadline (configurable where the
  provider exposes options). A provider endpoint that accepted the connection and
  then stalled previously held a delivery worker open indefinitely. An expired
  deadline surfaces as a retryable `PROVIDER_TIMEOUT`.
- **@emito/provider-smsapi**, **@emito/provider-twilio**, **@emito/provider-fcm**
  — error messages now name the provider's own error code and, where relevant,
  the HTTP status. Error *codes*, retryability and error contexts are unchanged.

## [0.1.0] — unreleased

Initial public release. While the packages are on `0.x`, the public API surface
may still change: a breaking change bumps the minor version, and the HTTP API
keeps its `/v1` path rather than moving to `/v2`. From `1.0.0` on, breaking
changes to the packages require a major version, and breaking changes to the
wire contract get a new API version in the URL.

### Added

- Contribution guide, code of conduct, security policy, issue/PR templates, and
  CI + release workflows, in preparation for the public open-source release.
- **@emito/server** — the HTTP API is versioned. Every wire endpoint lives under
  `{prefix}/v1/…`; the version is inserted by the router, so it survives a
  custom `prefix`. Operational probes (`/health`, `/metrics`), email-embedded
  links (`/track/*`, `/unsubscribe`, `/confirm`) and inbound provider webhooks
  (`/webhooks/:provider`) sit directly under the prefix — versioning URLs that
  live in inboxes and third-party consoles would pin every past version open
  forever. `createEmitoServer` returns `apiBase` (the versioned base) next to
  `prefix` (the mount path).
- **@emito/js** — `EmitoClient` appends the API version it speaks to the
  configured `endpoint`. Pass the mount path (`https://app.com/emito`); adding
  `/v1` yourself would produce `/emito/v1/v1/…`.

- **@emito/core** — the notification engine: `createEmito`, the send/broadcast
  pipeline, preference and consent gates, lifecycle hooks, and observability.
- **@emito/types** — shared types, channel definitions, and schemas.
- **@emito/db** — Drizzle schema, client, repositories, ID generation, and the
  canonical SQL migrations.
- **@emito/templates** — localized template building, locale resolution, and
  channel formatters (email layout, Slack blocks, Telegram HTML).
- **@emito/auth-jwt** — JWT helpers and HS256 sign/verify for subscriber identity.
- **@emito/server** — the HTTP API (`createEmitoServer`) with Node, Fastify,
  Express, and Next.js adapters, plus native in-app and webhook delivery.
- **@emito/js**, **@emito/react-hooks**, **@emito/react**,
  **@emito/react-native** — client SDKs and headless hooks for in-app
  notification UIs over WebSocket, SSE, or polling.
- **@emito/provider-resend**, **-twilio**, **-smsapi**, **-fcm**, **-slack**,
  **-telegram** — first-party provider plugins.
- **@emito/cli** — the `emito init` installer, including the agent skill.

[Unreleased]: https://github.com/emito-pro/emito/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/emito-pro/emito/releases/tag/v0.1.0
