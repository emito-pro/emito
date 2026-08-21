import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Library build for @emito/react. Vite natively supports CSS modules
// (`import styles from "./x.module.css"` -> scoped locals + emitted CSS),
// which tsup does not — tsup shipped empty locals + unscoped CSS, so every
// component rendered class="" and the UI was unstyled. Vite fixes that.
// Type declarations are emitted separately by `tsc` (see build script).
export default defineConfig({
	plugins: [react()],
	build: {
		lib: {
			entry: fileURLToPath(new URL("src/index.ts", import.meta.url)),
			formats: ["es"],
			fileName: () => "index.js",
		},
		cssCodeSplit: false,
		sourcemap: false,
		emptyOutDir: true,
		rollupOptions: {
			external: [
				"react",
				"react-dom",
				"react/jsx-runtime",
				"@emito/js",
				"@emito/react-hooks",
				"@floating-ui/react",
			],
			output: {
				// Emit the single bundled stylesheet as dist/index.css (the path the
				// package's `exports["./index.css"]` and consumers expect).
				assetFileNames: (asset) => {
					const name = asset.name ?? (asset.names && asset.names[0]) ?? "";
					return name.endsWith(".css") ? "index.css" : "assets/[name][extname]";
				},
			},
		},
	},
});
