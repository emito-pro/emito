<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/db

  **PostgreSQL persistence for Emito — Drizzle schema, migrations, and repository implementations.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)

  ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
  ![Drizzle](https://img.shields.io/badge/Drizzle-C5F74F?logo=drizzle&logoColor=black)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
</div>

## What it is

`@emito/db` is the PostgreSQL data layer for Emito. It defines the full Drizzle
schema for every Emito table, ships the SQL migrations that build that schema,
and provides concrete `Drizzle*Repository` classes that implement the storage
interfaces declared in `@emito/core`. A small set of helpers covers connection
setup, prefixed ID generation, reusable timestamp columns, cursor pagination,
soft-delete filtering, and transactions.

> The repository contracts live in `@emito/core`; this package is the only place
> that knows about PostgreSQL. Swapping or extending the storage backend means
> implementing those interfaces — the rest of Emito depends on the contract,
> not on Drizzle.

## Install

`@emito/db` is a workspace package in the Emito monorepo and is not yet
published to npm. Inside the monorepo, depend on it with the workspace protocol:

```jsonc
// package.json
{
  "dependencies": {
    "@emito/db": "workspace:*"
  }
}
```

`@emito/db` depends on `drizzle-orm` and the `postgres` driver (both bundled as
direct dependencies) and on `@emito/types`. The repository classes implement
interfaces from `@emito/core`, so a consuming package typically depends on that
alongside it. Standalone publishing to npm is planned.

## Usage

```ts
import {
  createDrizzleClient,
  DrizzleNotificationRepository,
  generateId,
  ID_PREFIX,
} from "@emito/db";

// 1. Open a Drizzle client over a PostgreSQL connection string.
const db = createDrizzleClient(process.env.DATABASE_URL!);

// 2. Wrap a table set in its repository.
const notifications = new DrizzleNotificationRepository(db);

// 3. Use the repository through the @emito/core contract.
const record = await notifications.create({
  id: generateId(ID_PREFIX.notification),
  subscriberId: "user_123",
  workspaceId: "ws_default",
  eventType: "order.shipped",
  channel: "email",
  deliveryAddress: "ada@example.com",
});
```

Run migrations against the database the client points at:

```sh
DATABASE_URL=postgres://... pnpm --filter @emito/db db:migrate
```

## API surface

### Client and identifiers

| Export | Kind | Description |
| --- | --- | --- |
| `createDrizzleClient(connectionString)` | function | Builds a Drizzle client over `postgres-js` with `casing: "snake_case"` column mapping. |
| `generateId(prefix)` | function | Returns a `{prefix}_{uuidv7}` identifier with dashes stripped. |
| `ID_PREFIX` | const | Frozen map of entity prefixes (`notification`, `subscriber`, `list`, …). |

### Helpers

| Export | Kind | Description |
| --- | --- | --- |
| `timestamps` | const | Reusable `createdAt` / `updatedAt` `TIMESTAMPTZ` columns with `defaultNow()`. |
| `encodeCursor` / `decodeCursor` | function | Opaque base64url cursor token encode/decode. |
| `cursorPaginate` | function | Slices an ordered row set into a `{ data, nextCursor }` page. |
| `withSoftDelete(column)` | function | `IS NULL` condition that excludes soft-deleted rows. |
| `withTransaction(db, fn)` | function | Runs `fn` inside a Drizzle transaction. |
| `CursorPaginateOptions`, `CursorPaginateResult<T>` | types | Pagination input/output shapes. |

### Repositories

Each class implements its corresponding `@emito/core` storage interface and is
constructed with a `DrizzleDb` instance.

| Export | Backs |
| --- | --- |
| `DrizzleNotificationRepository` | Notification log |
| `DrizzleInboxRepository` | In-app inbox |
| `DrizzleSubscriberRepository` | Subscribers |
| `DrizzlePreferenceRepository` | Notification preferences |
| `DrizzleWorkspaceDefaultRepository` | Workspace defaults |
| `DrizzleConsentRepository` | Consent records |
| `DrizzleSuppressionRepository` | Suppression list |
| `DrizzleDeadLetterRepository` | Dead-letter queue |
| `DrizzleIntegrationRepository` | Provider integrations |
| `DrizzleListRepository` / `DrizzleListMemberRepository` | Audience lists and members |
| `DrizzleAuditLogRepository` | Audit log |
| `DrizzleAlertRepository` / `DrizzleAlertHistoryRepository` | Alerts and alert history |
| `DrizzleSavedViewRepository` | Saved views |
| `DrizzleApiKeyRepository` | API keys |
| `DrizzleScheduledSendRepository` | Scheduled sends |
| `DrizzleBroadcastRepository` | Broadcasts |
| `DrizzleTemplateOverrideRepository` | Template overrides |
| `DrizzleTeamMemberRepository` | Team members |

The `DrizzleDb` type, the `emito_*` schema tables and their relations, and the
admin-facing types (`AdminNotificationListFilters`, `AdminNotificationRow`,
`TeamMemberRecord`, `TeamMemberRole`, and related) are also exported from the
package root.

### Schema and migrations

- All table definitions are re-exported from the package root (`emito_notifications`,
  `emito_subscribers`, `emito_inbox`, and the rest of the `emito_*` set) for use
  in queries and in tooling.
- The generated SQL migrations live in `./drizzle` and are published with the
  package; they are also reachable via the `@emito/db/drizzle` subpath export.
- `pnpm --filter @emito/db db:generate` regenerates migrations from the schema;
  `pnpm --filter @emito/db db:migrate` applies them. Both read `DATABASE_URL`.

## Part of Emito

`@emito/db` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Core engine and storage contracts** — [`@emito/core`](../core/README.md)
- **Shared types** — [`@emito/types`](../types/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
