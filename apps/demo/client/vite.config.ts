import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { defineConfig } from "vite";

const packagesDir = path.resolve(__dirname, "../../../packages");

export default defineConfig({
	plugins: [react()],
	css: {
		postcss: {
			plugins: [
				tailwindcss({ config: path.resolve(__dirname, "tailwind.config.ts") }),
				autoprefixer(),
			],
		},
	},
	resolve: {
		alias: {
			"@emito/react": path.resolve(packagesDir, "react/src/index.ts"),
			"@emito/react-hooks": path.resolve(packagesDir, "react-hooks/src/index.ts"),
			"@emito/js": path.resolve(packagesDir, "js/src/index.ts"),
			"@emito/types": path.resolve(packagesDir, "types/src/index.ts"),
		},
	},
	server: {
		fs: {
			allow: [path.resolve(__dirname, "../../..")],
		},
		proxy: {
			"/login": "http://localhost:3001",
			"/api": "http://localhost:3001",
			"/emito": {
				target: "http://localhost:3001",
				ws: true,
			},
		},
	},
});
