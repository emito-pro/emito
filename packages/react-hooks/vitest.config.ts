import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: false,
		environment: "jsdom",
		include: ["__tests__/**/*.test.{ts,tsx}"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["src/**/index.ts"],
			thresholds: {
				statements: 85,
				branches: 85,
				functions: 85,
				lines: 85,
			},
		},
	},
});
