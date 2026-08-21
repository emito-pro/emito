# Contributing to Emito

First off — thank you for taking the time to contribute! Emito is
self-hosted, provider-agnostic notification infrastructure, and it gets better
with every issue, fix, provider plugin, and doc improvement the community sends.

This document explains how to get set up, the standards we hold code to, and how
to get a change merged. If anything here is unclear or out of date, that itself
is worth an issue or a PR.

- [Code of conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Reporting bugs](#reporting-bugs)
- [Requesting features](#requesting-features)
- [Security issues](#security-issues)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Coding standards](#coding-standards)
- [Testing](#testing)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Adding a provider](#adding-a-provider)
- [Releases](#releases)
- [License](#license)

## Code of conduct

This project is governed by the [Contributor Covenant](./CODE_OF_CONDUCT.md).
In short: be respectful, assume good intent, and keep discussion focused on the
work. Harassment, personal attacks, and dismissive behavior are not welcome in
issues, pull requests, or any other project space, and maintainers may edit,
lock, or remove contributions that don't meet that bar.

If you experience or witness unacceptable behavior, report it privately to
**security@emito.io**. Reports are handled confidentially.

## Ways to contribute

You don't have to write engine code to help:

- **Report bugs** and **request features** (see below).
- **Improve documentation** — the root and per-package READMEs, and the docs
  site under [`apps/docs`](./apps/docs/README.md).
- **Write a provider plugin** for a channel Emito already models — see
  [Adding a provider](#adding-a-provider).
- **Fix issues** — anything labeled `good first issue` or `help wanted` is a
  great place to start.

For anything larger than a bug fix or a small, self-contained improvement, please
**open an issue first** so we can agree on the approach before you invest time.
It's no fun to write a big PR only to find the design should have gone another
way.

## Reporting bugs

Search [existing issues](../../issues) first — someone may have already reported
it. If not, open a [bug report](../../issues/new?template=bug_report.yml); the
template asks for what the maintainers need:

- **What happened** and **what you expected** instead.
- **Steps to reproduce** — ideally a minimal snippet or a failing test.
- **Environment** — Node version, package manager, OS, the `@emito/*` package(s)
  and versions involved.
- **Logs / stack traces**, with any secrets redacted.

A reproduction that fails deterministically is the single most helpful thing you
can attach.

## Requesting features

Open a [feature request](../../issues/new?template=feature_request.yml)
describing the **problem you're trying to solve**, not just the solution you have
in mind — that gives us room to find the best fit for the engine's existing model
(channels, providers, preferences, templates). Mention whether you'd be willing
to implement it.

## Security issues

**Please do not open public issues for security vulnerabilities.** Report them
privately so they can be fixed before disclosure:

- Open a [GitHub private security advisory](../../security/advisories/new) for
  this repository, **or**
- Email **security@emito.io**.

[`SECURITY.md`](./SECURITY.md) has the full policy — what's in scope, what to
include, and the response times you can expect. We'll acknowledge your report,
work with you on a fix, and credit you in the release notes unless you prefer to
stay anonymous.

## Development setup

Emito is a **pnpm + Turborepo monorepo** on **Node.js ≥ 22**.

```sh
# 1. Fork and clone
git clone https://github.com/<your-username>/emito.git
cd emito

# 2. Use the Node version the repo targets (.nvmrc)
nvm use          # or: fnm use / asdf install

# 3. Install every workspace (pnpm is pinned via packageManager in package.json;
#    `corepack enable` will use the right version automatically)
pnpm install

# 4. Verify a clean baseline before you change anything
pnpm build        # build every package (turbo)
pnpm test         # run the test suites (turbo)
pnpm lint         # lint + format check (Biome)
pnpm check        # type-check
```

To see the whole platform running against a real PostgreSQL and Redis, use the
bundled Docker stack (details in the root
[`README.md`](./README.md#quickstart)):

```sh
docker compose -f docker-compose.demo.yml up -d --build
```

> `apps/docs` is intentionally **outside** the pnpm workspace and has its own
> lockfile — run it with the `docs:*` scripts (`pnpm docs:dev`), not
> `pnpm --filter`. See [`apps/docs/README.md`](./apps/docs/README.md).

## Project layout

The monorepo is layered: shared types at the base, the core engine and its
collaborators above, then the server and the SDKs. The full package and
app tables — with a one-line purpose for each — live in the root
[`README.md`](./README.md#monorepo). Skim that before your first change so you
put code in the package it belongs to.

**Keep changes scoped to the package they belong to.** A change that spans
several packages is fine when the feature genuinely requires it, but avoid
drive-by edits in unrelated packages.

## Coding standards

- **Language:** TypeScript, ES modules (`"type": "module"`). Node ≥ 22.
- **Formatting & linting:** [Biome](https://biomejs.dev/). Config lives in
  [`biome.json`](./biome.json) — **tab** indentation, a **100**-column line
  width, and import organization are all enforced. Run:

  ```sh
  pnpm lint                 # check across the workspace (turbo)
  pnpm exec biome check --write .   # auto-fix formatting + safe lint fixes
  ```

- **Types:** the workspace must type-check cleanly with `pnpm check`. Prefer
  precise types over `any`; export public types from the owning package.
- **Validation:** runtime input is validated with [Zod](https://zod.dev/) —
  follow the existing pattern (e.g. the provider config schemas) rather than
  hand-rolling checks.
- **Errors:** throw the typed `EmitoError` with an appropriate `EMITO_ERROR_CODE`
  so the engine can decide retry/suppression behavior. Look at an existing
  provider for the convention.
- **Naming:** identifiers carry the full product name — `Emito`, never a
  truncated `Emit`. That covers types, classes, components, hooks, and
  factories: `EmitoClient`, `EmitoProvider`, `EmitoConfig`, `createEmitoServer`,
  `useEmitoClient`. Values that cross a boundary are a separate namespace and
  are already consistent — leave them alone: error-code *strings*
  (`DELIVERY_FAILED`), environment variables (`EMITO_*`), HTTP headers
  (`X-Emito-*`), and CSS custom properties (`--emito-*`).
- Match the style of the surrounding code — naming, structure, and comment
  density. Comment the *why*, not the *what*.

## Testing

Tests run on [Vitest](https://vitest.dev/); suites live in each package's
`src/__tests__/` directory.

```sh
pnpm test                              # everything (turbo)
pnpm --filter @emito/core test         # a single package
```

- **Add tests for behavior changes** — a bug fix should come with a test that
  fails without it; a feature should cover its main paths and edge cases.
- Note that `turbo` runs `test` **after** `build` (see
  [`turbo.json`](./turbo.json)), so a failing build blocks the tests.
- Make sure `pnpm build`, `pnpm test`, `pnpm lint`, and `pnpm check` all pass
  before you open a PR — [CI](./.github/workflows/ci.yml) runs exactly that gate
  on Node 22 and 24, plus a build of the docs site.
- Integration suites start Postgres and Redis through
  [testcontainers](https://testcontainers.com/), so they need a running Docker
  daemon. Without one they skip themselves instead of failing — if you're
  touching the engine or the database layer, run them with Docker up.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) for a
clean, scannable history. It isn't currently enforced by a hook, but please
match it:

```
feat(provider-smsapi): map rate-limit responses to RATE_LIMITED
fix(core): stop double-recording blocked outcomes
docs(readme): document the SMSAPI provider
test(server): cover CSRF double-submit rejection
```

- Use a **scope** matching the package or app (`core`, `server`, `db`,
  `provider-twilio`, `provider-kit`, `readme`, …).
- Write the subject in the imperative mood, lower case, no trailing period.
- Keep each commit focused; explain the *why* in the body when it isn't obvious.

## Pull requests

Work happens on **feature branches against `main`**.

1. Branch from an up-to-date `main` (`git switch -c feat/my-change`).
2. Make your change, with tests and docs updated alongside the code.
3. Run the full gate locally: `pnpm build && pnpm test && pnpm lint && pnpm check`.
4. Add a line to [`CHANGELOG.md`](./CHANGELOG.md) under `## [Unreleased]` if the
   change is user-visible. Internal refactors, test-only changes, and dependency
   bumps don't need one.
5. Open the PR — the template asks for **what** changed, **why**, and how you
   verified it. Link the issue it addresses (`Closes #123`).
6. Keep the PR **focused** — one logical change per PR reviews faster than a
   grab-bag. Split unrelated work.
7. Be responsive to review feedback; maintainers may ask for changes before
   merging.

Draft PRs are welcome for early feedback on work in progress.

## Adding a provider

Emito is provider-agnostic: a channel exists in the engine, and each provider is
a plugin behind the single `ProviderPlugin` contract, so a new integration is a
**plugin, not a core change**. To add one:

1. Create `packages/provider-<name>/` mirroring an existing provider such as
   [`@emito/provider-twilio`](./packages/provider-twilio/README.md) or
   [`@emito/provider-smsapi`](./packages/provider-smsapi/README.md) — same
   `package.json` shape, `tsconfig`, and `vitest.config.ts`.
2. Export a `create<Name>Provider(config)` factory built with `defineProvider`
   from [`@emito/provider-kit`](./packages/provider-kit/README.md). It validates
   config with a Zod schema, hands `deliver` params already narrowed to the
   channel, builds the error context, and guarantees callers only ever see an
   `EmitoError`. The kit is a convenience, not a requirement — a provider
   written by hand against the `ProviderPlugin` contract from `@emito/types` is
   equally valid, and the engine cannot tell the difference.
3. Map the service's errors onto `EMITO_ERROR_CODE` values with `deliveryError`
   and `httpDeliveryError`. Do not set `isRetryable` by hand: it is derived from
   the code via `RETRYABLE_RECORD` in `@emito/types`, which is what the delivery
   engine reads.
4. Keep credentials, recipient addresses and message bodies out of the error
   context — it is logged and persisted on dead-letter records. Details that
   help debugging belong in the error message.
5. Add tests under `src/__tests__/`, using the fixtures and assertions from
   `@emito/provider-kit/testing`, and a package `README.md` documenting the
   config, API surface, and error mapping.
6. Add the provider to the **Providers** and **Packages** tables in the root
   [`README.md`](./README.md).

## Releases

Releases are cut by maintainers. Every `@emito/*` package ships under a single
shared version, so a release moves the whole platform at once.

1. Move the entries under `## [Unreleased]` in [`CHANGELOG.md`](./CHANGELOG.md)
   into a new version heading with today's date.
2. Set the new version in every publishable `package.json`
   (`pnpm -r --filter "./packages/*" exec npm version <version> --no-git-tag-version`),
   and bump the `@emito/*` ranges in `peerDependencies` by hand — `npm version`
   only touches the `version` field. Commit both.
3. Tag it (`git tag v<version> && git push origin v<version>`).

Pushing a `v*` tag runs [the release workflow](./.github/workflows/release.yml),
which re-runs the full gate, packs every non-private package under `packages/`
into tarballs (`node scripts/pack-release.mjs`), attaches them to a GitHub
Release, and — once an `NPM_TOKEN` secret exists — publishes to npm. Until then
the npm step is skipped automatically, and the Release tarballs are the way
consumers install; see the docs site's
[Install page](https://docs.emito.io/install/).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE) that covers this project. You confirm you have the
right to submit the work under that license.

---

Thanks again for helping build Emito. 💌
