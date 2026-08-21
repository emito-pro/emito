import type { Config } from "tailwindcss";

export default {
	content: [
		"./client/index.html",
		"./client/src/**/*.{ts,tsx}",
		"./index.html",
		"./src/**/*.{ts,tsx}",
	],
	theme: {
		extend: {},
	},
	plugins: [],
} satisfies Config;
