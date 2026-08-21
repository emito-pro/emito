import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: false,
		environment: "jsdom",
		include: ["__tests__/**/*.test.{ts,tsx}"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["src/**/index.ts", "src/**/*.css", "src/**/*.d.ts"],
			thresholds: {
				statements: 90,
				branches: 85,
				functions: 90,
				lines: 90,
			},
		},
	},
});
