---
title: Why Emito
description: Where Emito fits, what makes it different, and how it compares to notification platforms.
---

Emito is a **code-first, self-hosted notification engine you embed in your own backend**. Your configuration and templates live in your repository, your data lives in your Postgres and Redis, and there is no external control plane. Integrating is thin glue: mount a plugin, bridge one token, call `emito.send()`.

## What makes Emito different

- **Self-hosted first.** Emito runs entirely inside your infrastructure. There's no hosted tier to depend on, no data leaving your systems, and nothing to reconcile between a cloud console and your app.
- **Config & templates as code.** Categories, events, and templates are declared in your repo and versioned with your app rather than authored in a separate dashboard. Adding a notification is three lines, reviewed like any other change.
- **A library, not a platform.** Emito mounts into the backend you already run (Fastify, Express, Next.js, Hono, generic Node; see [Prerequisites](/prerequisites/) for the current list). You call `emito.send()` in-process; there's no separate service to trigger over the network.
- **Auth-agnostic.** Emito never owns your users. You bridge your existing auth with a short-lived token; the subscriber id is your stable user id.
- **You own the data.** Subscribers, preferences, and the inbox live in your Postgres (`emito_` tables); real-time runs on your Redis.

## How Emito compares

Emito is in the same category as notification platforms such as **[Novu](https://novu.co)**: both give you an in-app inbox, multi-channel delivery, subscribers, and preferences, but they take a different **shape**. This is an approach comparison, not a feature scoreboard.

| Dimension | Notification platform (e.g. Novu) | Emito |
|---|---|---|
| **Deployment** | Cloud-first, with a self-host option | Self-hosted first (an embedded library, no control plane) |
| **Core model** | Visual **workflow builder** + orchestration | **Events → templates**, declared as code |
| **Where logic lives** | Authored in the dashboard | In your repository, versioned with your app |
| **Trigger** | Call the platform API/SDK over the network | `emito.send()` in-process |
| **Channels** | Broad (in-app, email, SMS, push, chat) + a large provider marketplace | Focused (in-app, email, SMS, push, Slack/Telegram) |
| **Auth** | Platform subscriber / API-key model | Auth-agnostic; bridge your own |

## When Emito is the right fit

- You want to **self-host completely**, with no external dependency and no data leaving your systems.
- You prefer notification **config and templates versioned in your repo**, changed via pull requests.
- You want **minimal moving parts** dropped into a backend you already operate.
- Your channels are covered by **in-app, email, SMS, push, Slack, or Telegram** today.

## When a platform fits better

- You want a **managed, hosted** service and a **visual workflow builder** non-engineers can edit.
- You need a **large provider marketplace** out of the box, or a channel
  Emito doesn't ship yet.
- You'd rather trigger notifications over an API than embed an engine in your backend.

Novu is an excellent choice there, since it's a leading open-source notification platform with a broad provider ecosystem. Emito optimizes for a different point: **own your notification stack, in your code, in your infrastructure.**
