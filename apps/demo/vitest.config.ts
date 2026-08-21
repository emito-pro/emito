import { defineConfig } from "vitest/config";

/**
 * Vitest config for the demo's server-side unit tests.
 *
 * Discovery is scoped to `server/**` so only the demo's own server code is
 * collected.
 */
export default defineConfig({
	test: {
		include: ["server/**/*.{test,spec}.ts"],
		exclude: ["node_modules/**", "dist/**"],
	},
});
