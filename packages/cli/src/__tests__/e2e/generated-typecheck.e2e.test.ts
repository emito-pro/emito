import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BackendFramework } from "../../detect/framework.js";
import { renderConfigTemplate } from "../../generate/config-template.js";
import { renderMountTemplate } from "../../generate/mount-template.js";

// vitest's esbuild transform strips types without checking them, so no other test
// can catch a type error in the *generated* files (this is exactly how the
// `import type { ProviderPlugin } from "@emito/types"` bug — a package the CLI
// never installs — survived every earlier review). This suite writes the
// generated pair to disk and runs the real `tsc --noEmit` over it.
//
// Fixture dirs live *inside* packages/cli so bare specifiers (`@emito/core`,
// `@emito/provider-resend`, `express`, `fastify`, `hono`, `@types/node`) resolve through
// packages/cli/node_modules exactly as they would in a consumer project.
const e2eDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tscBin = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");

function typecheckGenerated(framework: BackendFramework, channels: Array<"email" | "sms">): string {
	const dir = mkdtempSync(join(e2eDir, ".typecheck-"));
	try {
		writeFileSync(join(dir, "emito.config.ts"), renderConfigTemplate({ framework, channels }));
		writeFileSync(join(dir, "emito.mount.ts"), renderMountTemplate({ framework, channels }));
		writeFileSync(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					strict: true,
					module: "nodenext",
					moduleResolution: "nodenext",
					target: "es2022",
					noEmit: true,
					// The generated files are checked, not the libraries they import —
					// unrelated errors inside @emito/* .d.ts files are not this test's job.
					skipLibCheck: true,
					types: ["node"],
				},
				include: ["emito.config.ts", "emito.mount.ts"],
			}),
		);

		try {
			execFileSync(process.execPath, [tscBin, "--project", join(dir, "tsconfig.json")], {
				encoding: "utf8",
				stdio: "pipe",
			});
			return "";
		} catch (error) {
			const failure = error as { stdout?: string; stderr?: string };
			return `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("generated glue files typecheck", () => {
	it("typechecks the generic Node scaffold with both email and sms providers", () => {
		// `channels: ["email", "sms"]` is what forces the conditional
		// `await import("@emito/provider-resend")` / `("@emito/provider-smsapi")`
		// branches of config-template.ts into the compiled output at all.
		expect(typecheckGenerated("node", ["email", "sms"])).toBe("");
	}, 120_000);

	it("typechecks the in-app-only scaffold", () => {
		expect(typecheckGenerated("node", [])).toBe("");
	}, 120_000);

	it("typechecks the express scaffold", () => {
		expect(typecheckGenerated("express", ["email"])).toBe("");
	}, 120_000);

	it("typechecks the fastify scaffold", () => {
		expect(typecheckGenerated("fastify", ["sms"])).toBe("");
	}, 120_000);

	it("typechecks the hono scaffold", () => {
		expect(typecheckGenerated("hono", ["email"])).toBe("");
	}, 120_000);
});
