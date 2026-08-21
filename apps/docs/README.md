# @emito/docs

The [docs.emito.io](https://docs.emito.io) site — [Astro](https://astro.build) +
[Starlight](https://starlight.astro.build). Built to a static `dist/` and served in
production by the tiny static server in `server.mjs` (via the `Dockerfile`, deployed
on Railway).

`apps/docs` is deliberately excluded from the pnpm workspace (`!apps/docs` in
`pnpm-workspace.yaml`) with its own lockfile, so it can't be reached with
`pnpm --filter`. It gets its own isolated `pnpm install` (see the Dockerfile's
`--ignore-workspace` build stage) — don't move it back into the workspace without
checking why it was pulled out first.

## Running locally

From the repo root:

```bash
pnpm docs:dev       # dev server with hot reload, http://localhost:4321
pnpm docs:build     # production build → dist/
pnpm docs:preview   # serve the built dist/ locally
```

(Equivalent to `pnpm -C apps/docs <dev|build|preview>`, or `cd apps/docs && pnpm dev`.)

## Updating a page

Pages are markdown/mdx under `src/content/docs/`:

```
index.mdx, why-emito.md, prerequisites.md   — Getting started
install.md, migrate.md, configure.md,       — Guide (numbered 1-6)
  backend.md, frontend.md, i18n.md
gotchas.md, add-a-notification.md           — Reference
concepts/{subscribers,channels,preferences}.md
admin/{overview,managing}.md                — Draft (badge in sidebar)
self-hosting/{architecture,railway}.md
ai/{overview,skill,mcp,llms-txt}.md         — Draft (badge in sidebar)
roadmap.md
```

Edit the file — content changes need nothing else.

**Adding a new page is a two-step change:**

1. Add the `.md`/`.mdx` file under `src/content/docs/` (with Starlight frontmatter —
   see any existing page).
2. Add a matching entry to the `sidebar` array in `astro.config.mjs`, with a `slug`
   that matches the file's path (without extension). A page with no sidebar entry
   builds fine but is unreachable from the nav.

Skipping step 2 is the most common way to "lose" a page — if a page you added isn't
showing up, check the sidebar first.

## Verifying before pushing

There's no CI for this repo — `pnpm docs:build` failing locally is the only guard,
so run it before pushing doc changes:

```bash
pnpm docs:build
```
