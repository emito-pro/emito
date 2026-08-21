import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// The e2e suite (src/__tests__/e2e/**) spins up real Postgres/Redis via
		// testcontainers and is run separately via `test:e2e` (vitest.e2e.config.ts).
		// Keep it out of the default `test` run so plain unit-test runs don't
		// require Docker.
		exclude: [...configDefaults.exclude, "src/__tests__/e2e/**"],
		// The first `await import("../commands/init.js")` in a worker pulls in
		// drizzle/postgres/ioredis under coverage instrumentation, which occasionally
		// exceeded the 5s default and flaked the first test in init-command.test.ts.
		testTimeout: 20_000,
	},
});
