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
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/__tests__/**",
				"src/index.ts",
				"src/repositories/index.ts",
				"src/repositories/*-repository.ts",
				"src/repositories/types.ts",
				"src/repositories/admin-types.ts",
			],
			thresholds: {
				statements: 90,
				branches: 85,
				functions: 90,
				lines: 90,
			},
		},
	},
});
