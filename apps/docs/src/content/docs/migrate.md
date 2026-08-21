---
title: Migrate the schema
description: Run Emito's bundled Drizzle migrations into an isolated schema.
---

If you installed via `emito init`, this already ran as part of that
command. Read on only if you need to run it manually (a separate deploy
step, CI, a fresh environment `emito init` didn't touch).

Run `@emito/db`'s bundled Drizzle migrations once, into an **isolated
migrations schema** so Emito's tracking doesn't collide with your own:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createRequire } from 'node:module';
import path from 'node:path';
import postgres from 'postgres';

const migrationsFolder = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@emito/db/package.json')),
  'drizzle',
);
// Single-connection client ensures SET search_path and migrate() share the
// same connection. See the search_path gotcha below.
const sql = postgres(process.env.DATABASE_URL!, {
  max: 1,
  connection: { search_path: 'public' },
});
const db = drizzle(sql, { casing: 'snake_case' });
try {
  await migrate(db, { migrationsFolder, migrationsSchema: 'emito' });
} finally {
  await sql.end();
}
```

- `createRequire(...).resolve('@emito/db/package.json')` locates the installed
  package on disk regardless of your module resolution setup, then the
  `drizzle` folder next to it holds the bundled migration files.
- `migrationsSchema: 'emito'` keeps Drizzle's own migration-tracking table
  (which records which migrations have run) out of your `public` schema and
  away from your own migration tooling.

:::caution[search_path gotcha: name your Postgres role something other than "emito", or force search_path]
Postgres resolves the `"$user"` entry in `search_path` (default: `"$user",
public`) to the name of the connecting role. If that role is named
`emito` (a very natural choice for a dedicated Emito database user), it now
collides with the `emito` schema created above: Postgres puts unqualified
`CREATE TABLE` statements from the migration files into the `emito` schema
instead of `public`, while those same files' cross-table foreign keys are
hardcoded to `"public"."table_name"`, producing `relation
"public.emito_categories" does not exist`. The `connection: { search_path:
'public' }` option above closes this regardless of what the connecting role
is named.
:::

:::note[Deploy note]
If migrations run as a separate deploy step or image (e.g. a Railway release
command, a Kubernetes init container), that image **must contain
`@emito/db`**, because the migration files are bundled inside the package, not a
separate artifact.
:::

Next: [Configure](/configure/), where your notification types and templates
live.
