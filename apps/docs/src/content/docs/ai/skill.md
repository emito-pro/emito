---
title: Emito Skill
description: A packaged skill that teaches an AI agent to integrate Emito correctly.
---

The **Emito Skill** is a self-contained agent skill an agent loads on
demand. It doesn't reimplement the integration steps itself; instead it wraps the
[`emito init` CLI](/install/) and adds the things the CLI deliberately
doesn't do: finding your project's real entrypoint and wiring the generated
mount call into it, and wiring the notification UI into your frontend (or a
plain-JS equivalent if you have none).

## Install it

```bash
npx @emito/cli@latest agent-skill
```

This copies a `SKILL.md` into `.claude/skills/emito-init/` in the current
project. It's a plain file copy, so it's safe to run once per project, and it
**won't silently overwrite** an existing copy on a re-run (you'll get a
message telling you to delete it first if you want a fresh one).

## Use it

Once installed, just ask an AI coding agent to install Emito ("add Emito
notifications to this app"). The skill instructs the agent to:

0. Check whether `emito init` already ran (looking for `emito.config.ts`/
   `emito.mount.ts`) before doing anything else: an existing, correct
   install is left alone rather than re-run "just to be sure."
1. Ask which channels you want beyond in-app (email, SMS, or neither), then
   run `emito init -y --channels ...` **non-interactively**, because an agent can't
   answer an interactive wizard's prompts, so it always passes `-y` with
   `DATABASE_URL`/`REDIS_URL` already set in the environment.
2. Find the project's actual server entrypoint (`src/server.ts`,
   `src/index.ts`, wherever `app.listen`/`fastify.listen` is called).
3. Insert the import and `mountEmito(...)` call at the right spot. The
   exact snippet differs per framework (Express, Fastify, Hono, Next.js, generic
   Node), and the skill knows all five, including the Express-specific
   `req.originalUrl` gotcha and the WebSocket upgrade wiring Express/Hono/generic
   Node need on top of the HTTP mount (see [Gotchas](/gotchas/)). It also adds
   `cookieName` to `resolveSubscriberId` if the frontend will use the
   WebSocket transport in a browser.
4. Wire the notification UI, meaning a bell, an inbox, and a preferences page,
   even when the project has no React frontend. If `emito init` detected
   React, the agent uses `@emito/react`'s prebuilt components
   (`NotificationBell`, `InboxPopover`, `PreferenceCenter`); otherwise it
   wires the same three surfaces by hand with `@emito/js`'s
   framework-agnostic `EmitoClient`. See [Frontend](/frontend/) for both
   paths.
5. Run the project's typecheck/build to confirm nothing broke.
6. Report back what was installed, what was generated, what it edited, and
   how to verify delivery (hit `/emito/health` or `/emito/v1/capabilities`,
   and check the bell/preferences page actually render and update).

## Why a thin wrapper, not a from-scratch integration

The CLI and the skill share one source of truth: everything the CLI can do
deterministically (detection, install, migration, code generation) happens
in the CLI, tested the same way regardless of whether a human or an agent is
driving. The skill's only job is the steps that genuinely need an agent:
reading and safely editing *your* existing code, and choosing the right UI
path for your stack. That keeps it from drifting from what the CLI actually does,
and there's nothing to keep "in sync with the library version" beyond
keeping the CLI itself up to date.

## What it doesn't do (yet)

The skill doesn't call Emito's REST API to prove delivery live from inside
the agent's own turn; that's still a manual check via `/emito/health` (see
step 6 above). A richer, tool-calling integration (an MCP server) may come
later.
