---
name: emito-init
description: Use when the user asks to add/install/integrate Emito (notification engine) into this project.
---

# Install Emito

This skill wraps the `emito init` command.

0. **Check whether `emito init` already ran** before doing anything else:
   look for `emito.config.ts`/`emito.config.js` and `emito.mount.ts`/
   `emito.mount.js` in the project root. If either exists, `init` already
   succeeded (by hand or in an earlier session) — skip straight to step 2
   (find the entrypoint and wire it in). Don't re-run `emito init` "just to
   be sure": it will only report `aborted-existing-install` and cost a
   needless round-trip asking the user whether to delete files that are
   already correct.

1. **Before running anything**, ask the user (if not already stated) which
   extra delivery channels they want beyond in-app: email, SMS, or neither.
   Then confirm `DATABASE_URL` and `REDIS_URL` are set in the shell you'll run
   in (ask the user for them if not).

   Run it **non-interactively** — `emito init` has an interactive wizard by
   default, and an agent can't answer prompts it didn't spawn a terminal for.
   Pass `-y` (skip all prompts, requires `DATABASE_URL`/`REDIS_URL` already
   set) and `--channels` explicitly:
   ```bash
   npx @emito/cli@latest init -y --channels email,sms
   ```
   (Omit `--channels` entirely for in-app-only. Add `--framework <name>` too
   if you already know it and want to skip auto-detection.) This will:
   - detect your package manager and backend framework (Express/Fastify/Hono/Next.js/generic Node)
   - install the required `@emito/*` packages — including `@emito/react` if a
     React frontend is detected (watch the output for a line starting
     "Frontend: detected ..." — that's your signal to do step 4 below)
   - run the Emito schema migration against `DATABASE_URL`
   - generate `emito.config.ts` and `emito.mount.ts` in the project root
   - print a status of `manual-mount-required` with the detected framework

   If it reports `aborted-prerequisites`, stop and tell the user to set
   `DATABASE_URL`/`REDIS_URL` first (see the Emito docs' `prerequisites` page)
   — do not attempt to work around this.

   If it reports `aborted-existing-install`, `emito.config.ts`/`emito.mount.ts`
   already exist — ask the user whether to remove them first, do not overwrite
   without asking.

2. Find the project's actual server entrypoint (e.g. `src/server.ts`,
   `src/index.ts`, `server/index.ts` — wherever the app/server instance is
   constructed and `listen`/`fastify.listen` is called).

3. Add, right after the app/server instance is created and before it starts
   listening. `buildEmitoServer()` returns `{ server, emito, repositories, cleanup }`
   — `server` is the `EmitoServer` to mount, `emito`/`repositories` are the
   same runtime `server` was built from (handy for a manual test-send route:
   `emito.send(...)`), `cleanup` shuts Emito down (stops workers, disconnects
   Redis) and should be wired into the app's shutdown path.
   Whenever you register a `SIGTERM` handler, always call `process.exit(0)`
   after `cleanup()` resolves — registering the listener disables Node's own
   default exit-on-SIGTERM, so without an explicit exit the process survives
   the signal and becomes a zombie still bound to the port on the next
   restart, serving requests against a DB connection `cleanup()` just closed:
   - **Express:**
     ```ts
     import { buildEmitoServer, mountEmito } from "./emito.mount";
     const { server: emitoServer, cleanup: emitoCleanup } = await buildEmitoServer();
     const { upgradeHandler } = mountEmito(app, emitoServer);
     const httpServer = app.listen(3000);
     httpServer.on("upgrade", upgradeHandler);
     process.on("SIGTERM", async () => {
       await emitoCleanup();
       process.exit(0);
     });
     ```
     Note: the generated Express mount deliberately uses `toNodeHandler` and
     restores `req.originalUrl` instead of `emitRouter` + `app.use("/emito", router)`
     — Express strips the mount path from `req.url`, which would make every
     `/emito/*` route 404. Don't "simplify" it back to `emitRouter`. Also note
     `mountEmito` here returns `{ upgradeHandler }` — Express only sees HTTP
     requests, so WebSocket upgrades have to be wired onto the underlying
     `http.Server` the same way as the generic Node adapter below; skipping
     that line leaves WS silently non-functional.
   - **Fastify:**
     ```ts
     const { server: emitoServer, cleanup: emitoCleanup } = await buildEmitoServer();
     mountEmito(app, emitoServer);
     app.addHook("onClose", emitoCleanup);
     ```
   - **Hono:**
     ```ts
     import { serve } from "@hono/node-server";
     const { server: emitoServer, cleanup: emitoCleanup } = await buildEmitoServer();
     const { upgradeHandler } = mountEmito(app, emitoServer);
     serve({ fetch: app.fetch, port: 3000 }).on("upgrade", upgradeHandler);
     process.on("SIGTERM", async () => {
       await emitoCleanup();
       process.exit(0);
     });
     ```
     WebSocket upgrades bypass Hono's router, so they have to be attached to the
     Node server `@hono/node-server` returns. On Bun/Deno/Workers drop the
     upgrade wiring and use the SSE or polling transport.
   - **Next.js:** create `app/emito/[...route]/route.ts` with
     `const { server } = await buildEmitoServer();` and re-export
     `mountEmito(server)` as `GET`/`POST`/`PUT`/`PATCH`/`DELETE`.
   - **Generic Node:** `const { server, cleanup } = await buildEmitoServer();`
     then wire `mountEmito(server)`'s `{ handler, upgradeHandler }` into your
     `http.createServer` request/upgrade listeners, and call `cleanup()` on
     shutdown.

   Also review the `// SECURITY TODO` in `emito.mount.ts`: the generated
   `resolveWorkspaceRole` grants workspace-admin to every authenticated
   subscriber and must be replaced before production use.

   If the frontend (step 4) will use the WebSocket transport in a browser —
   which it will, by default, unless you override `transport` — a browser's
   `WebSocket` constructor can't attach an `Authorization` header, so the
   client authenticates the handshake via cookie instead. Without doing
   anything else, that cookie check has nothing to check: `createJwtAuth`
   only reads the `Authorization` header unless you pass `cookieName`. Add it
   in `emito.mount.ts`:
   ```ts
   resolveSubscriberId: createJwtAuth({ hmacSecret: jwtSecret, cookieName: "emito_token" }),
   ```
   and, wherever the app already sets its own session cookie on login, also
   set a `emito_token` cookie to the same JWT you hand to `EmitoProvider` in
   step 4. Skipping this doesn't error — REST calls keep working over the
   `Authorization` header — but the bell/toast never update live, silently.

4. Wire a bell and a preferences page into the UI — do this even when step 1
   said no frontend framework was detected. "No React" means no
   `@emito/react` components, not no bell: every project has *some* page the
   logged-in user sees, and that page can call the REST API directly. Which
   path depends on step 1's output:

   **If step 1's output said a frontend was detected** ("Frontend: detected
   react-next/react-vite/react — installed @emito/react"), do not hand-roll
   a bell/inbox/preferences UI from scratch when `@emito/react` is already
   installed and exactly for this — use the shipped components:

   - Import the stylesheet **once**, near the app's root (e.g. the root
     layout, or the top-level entry file): `import "@emito/react/index.css";`
     — there is no `@emito/react/styles.css` or `@emito/react/styles/*.css`;
     those don't exist. Skipping this import is the single most common way to
     end up with a bell/popover that renders but looks completely unstyled.
   - Wrap the authenticated part of the app in `EmitoProvider`:
     ```tsx
     import { EmitoProvider, NotificationBell, InboxPopover } from "@emito/react";

     <EmitoProvider endpoint="/emito" subscriberId={currentUserId} token={jwtForCurrentUser}>
       <NotificationBell />
       <InboxPopover />
     </EmitoProvider>
     ```
     `endpoint` can be relative (e.g. `/emito`, matching the server's
     `prefix`) — it resolves against the page's own origin automatically.
     `subscriberId` must be the exact same value embedded in the JWT you mint
     server-side for this user (mismatch → client rejected). Find or ask
     where the app already renders the logged-in user's own layout/header —
     that's where `NotificationBell` belongs, not a new standalone page.
   - Also add a preferences page using `PreferenceCenter`, and a link to it
     from wherever the app's own settings/account menu lives — don't leave
     it bell-only with no way to reach it:
     ```tsx
     import { PreferenceCenter } from "@emito/react";
     import type { TopicDefinition } from "@emito/react";

     <PreferenceCenter topics={topics} />
     ```
     `topics` isn't optional and isn't shipped for you — build it from this
     project's own `emito.config.ts`: one `TopicDefinition` per configured
     event, using that event's `category` and `channels`, e.g.
     ```ts
     const topics: TopicDefinition[] = [
       { topicKey: "user.welcome", label: "Welcome email", category: "transactional", channels: ["email"] },
       // ...one entry per event key in this project's emito.config.ts
     ];
     ```
     `label` is the only free text — write something a subscriber would
     recognize, not the raw event key.
   - Only reach for `@emito/react-hooks` (headless) instead of the prebuilt
     components if the user explicitly asked for fully custom UI — and even
     then, drive it through the hooks (e.g. `useEmitoClient`), not raw
     `fetch` calls against the REST endpoints.
   - If this app doesn't already mint a JWT for its logged-in users, add a
     small endpoint that does, using `signHS256` from `@emito/auth-jwt` with
     the same `EMITO_JWT_SECRET` `emito.mount.ts` reads — the frontend needs
     that token for the `EmitoProvider` prop above.

   **If step 1's output did not mention a frontend** (generic Node, or a
   server-rendered app with no React — Express/Fastify/Hono templates,
   plain HTML), there is no `@emito/react`. Add the bell and preferences
   with `@emito/js`'s framework-agnostic `EmitoClient` instead — it's
   already installed as a dependency of every generated project, drive
   everything through it rather than hand-rolled `fetch` calls:
     ```html
     <script type="module">
       import { EmitoClient } from "@emito/js"; // or a bundled/CDN path if this app has no build step
       const client = new EmitoClient({
         endpoint: "/emito",
         subscriberId: CURRENT_USER_ID, // from the page's own session, not hardcoded
         token: CURRENT_USER_JWT,       // minted the same way as the React path below
       });
       await client.connect();
       await client.fetchUnreadCount();
       document.querySelector("#emito-bell-count").textContent = client.getUnreadCount();
       client.on("notification", () => {
         document.querySelector("#emito-bell-count").textContent = client.getUnreadCount();
       });
     </script>
     ```
     Render a bell icon with a `#emito-bell-count` badge in whatever layout
     the logged-in pages already share (a header/nav partial), not a
     standalone page — same placement rule as the React path. Add a small
     inbox view (list `client.getNotifications()` / `client.notifications.list()`,
     call `client.markAsRead(id)` on click) and a preferences page (render one
     toggle per `client.preferences.get()` entry, call
     `client.updatePreference({ topicKey, channel, enabled })` on change) —
     link both from the same menu the bell lives in. If this app doesn't
     already mint a JWT for its logged-in users, add a small endpoint that
     does, using `signHS256` from `@emito/auth-jwt` with the same
     `EMITO_JWT_SECRET` `emito.mount.ts` reads.

5. Run the project's typecheck/build command to confirm nothing broke.

6. Report to the user: what was installed, what was generated, what you
   edited (backend mount, and — if applicable — the frontend wiring and CSS
   import), and how to verify:
   - Backend: start the app and check `/emito/v1/capabilities` (or the
     unversioned `/emito/health`) returns 200.
   - Frontend (if wired): load a page that renders `NotificationBell` and
     confirm it's actually styled (a plain unstyled icon/text usually means
     the `@emito/react/index.css` import is missing) and that the popover
     opens. Ask the user to eyeball it — you likely can't render a browser
     yourself.
