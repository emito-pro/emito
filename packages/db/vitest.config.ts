import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: false,
		environment: "node",
		include: ["__tests__/**/*.test.ts"],
		globalSetup: ["./__tests__/global-setup.ts"],
		setupFiles: ["./__tests__/test-setup.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
		// All integration test files share a single Testcontainers PostgreSQL
		// instance (see global-setup.ts) and the same set of `emito_*` tables.
		// Running files in parallel makes the per-test TRUNCATE in test-setup.ts
		// race across files — wiping rows mid-test and deadlocking on shared
		// tables. Serialize files so each owns the database while it runs.
		fileParallelism: false,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/__tests__/**",
				"src/index.ts",
				"src/client.ts",
				"src/schema/**",
				"src/repositories/**",
			],
			thresholds: {
				statements: 90,
				branches: 90,
				functions: 90,
				lines: 90,
			},
		},
	},
});
