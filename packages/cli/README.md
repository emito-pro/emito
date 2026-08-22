<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/cli

  **The installer CLI for Emito — `emito init`.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)
</div>

## What it is

`@emito/cli` installs Emito into an existing project. Adopting Emito by hand
means vendoring packages, wiring a JWT auth bridge, mounting a server handler,
writing config, and migrating a schema — this CLI does that work for you and
leaves behind two generated files you own outright.

It ships one binary, `emito`, with two commands:

| Command | What it does |
| --- | --- |
| `emito init` | Detects your stack, installs the right `@emito/*` packages, migrates the schema, and generates `emito.config.ts` + `emito.mount.ts`. |
| `emito agent-skill` | Drops an AI coding agent skill into `.claude/skills/emito-init/` so an agent can run the install *and* wire the mount call into your entrypoint. |

> The generated files are yours, shadcn-style — not a hidden library call. `emito
> init` writes the same hand-assembled scaffold the docs walk you through, then
> gets out of the way. Edit them freely.

## Install

```bash
npx @emito/cli@latest init
```

Working from a checkout of the monorepo instead? Build and invoke it directly:

```bash
git clone https://github.com/emito-pro/emito.git
cd emito && pnpm install
pnpm --filter @emito/cli build

# then, from your own project:
node /path/to/emito/packages/cli/dist/index.js init
```

## `emito init`

```bash
emito init
```

The run is a wizard, and nothing is written until you confirm the plan:

1. **Preflight (read-only).** Detects your package manager from the lockfile and
   your backend framework from `package.json` (`express`, `fastify`, `hono`,
   `next`, or the generic Node adapter). Checks that `DATABASE_URL` and `REDIS_URL` are set
   and reachable, prompting for anything missing. Aborts *before* touching
   anything if a prerequisite is unreachable, naming which service failed and
   why.
2. **Plan confirmation.** Prints exactly what will be installed and generated.
3. **Execution.** Installs the packages, appends the Emito block to
   `.env.example`, runs the Emito schema migration (in its own migrations table,
   isolated from yours), and writes `emito.config.ts` + `emito.mount.ts`.
4. **Summary.** Reports what was generated, what is left to do by hand, and the
   freshly generated `EMITO_JWT_SECRET` for you to paste into your real `.env`.

An existing `emito.config.ts` or `emito.mount.ts` aborts the run — the CLI never
silently overwrites files it did not write.

### Flags

| Flag | Description |
| --- | --- |
| `-y`, `--yes` | Skip every prompt and take the defaults (in-app only, auto-confirm the plan); requires DATABASE_URL and REDIS_URL to already be set. |
| `--channels <list>` | Comma-separated channels beyond in-app: `--channels email,sms`. |
| `--framework <name>` | Backend framework, skipping detection: `express`, `fastify`, `hono`, `nextjs`, or `node`. |

```bash
emito init --yes --channels email,sms --framework fastify
```

### The last step is yours

`emito init` generates the glue but does **not** edit your entrypoint — it can't
safely infer arbitrary existing code structure. It finishes with
`manual-mount-required` and tells you the one line to add:

```ts
import { buildEmitoServer, mountEmito } from "./emito.mount";

const { server, cleanup } = await buildEmitoServer();
mountEmito(app, server); // signature varies by framework — the generated file shows yours
```

## `emito agent-skill`

```bash
emito agent-skill
```

Copies the bundled skill into `.claude/skills/emito-init/SKILL.md`. Ask an AI coding agent
to "install Emito" and it runs `emito init`, then closes the gap the CLI
leaves open: it locates your real entrypoint, inserts the import and
`mountEmito` call at a safe point, and runs your typecheck as proof it didn't
break anything.

An existing `SKILL.md` is left untouched — delete it and re-run to take a fresh
copy.

## Generated files

| File | Contents |
| --- | --- |
| `emito.config.ts` | `createEmitoRuntime()` — the Drizzle repositories bundle, per-channel providers (falling back to mock providers when the API keys are absent), and `createEmito(...)` with a starter category/event to edit. |
| `emito.mount.ts` | `buildEmitoServer()` — `createEmitoServer(...)` wired to JWT auth, returning `{ server, emito, repositories, cleanup }` — plus a `mountEmito(...)` using the adapter matching your framework. |

> **Before production:** the generated `resolveWorkspaceRole` grants
> workspace-admin to every authenticated subscriber. Replace it with real
> workspace-role resolution — the generated file flags this with a
> `SECURITY TODO`.

## Part of Emito

`@emito/cli` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Core engine** — [`@emito/core`](../core/README.md)
- **HTTP server & adapters** — [`@emito/server`](../server/README.md)
- **Full documentation** — [docs.emito.io](https://docs.emito.io)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
