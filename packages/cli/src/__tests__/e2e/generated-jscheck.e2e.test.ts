import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BackendFramework } from "../../detect/framework.js";
import { renderConfigTemplate } from "../../generate/config-template.js";
import { renderMountTemplate } from "../../generate/mount-template.js";

// The `lang: "js"` output has no compiler to catch a mistake — a leftover
// `type X,`, `interface`, `satisfies`, or type annotation would be a syntax
// error the moment plain Node tries to import the file. `generate.test.ts`
// asserts none of those tokens appear; this suite additionally proves the
// result actually parses, via `node --check`, the same class of "vitest's
// esbuild transform won't catch this" gap the sibling `.e2e.` typecheck
// suite covers for the `lang: "ts"` path.
function checkJsSyntax(framework: BackendFramework, channels: Array<"email" | "sms">): void {
	const dir = mkdtempSync(join(tmpdir(), "emito-cli-jscheck-"));
	try {
		// `.mjs` (not `.js`) so `node --check` parses these as ESM without needing a
		// `"type": "module"` package.json in this throwaway temp dir — real generated
		// output is still `.js`, consumed by a project that already declares
		// `"type": "module"` (an Emito prerequisite). `--check` only parses, it never
		// resolves imports, so the extension mismatch inside import specifiers
		// (`./emito.config.js`) is irrelevant here.
		const configPath = join(dir, "emito.config.mjs");
		const mountPath = join(dir, "emito.mount.mjs");
		writeFileSync(configPath, renderConfigTemplate({ framework, channels, lang: "js" }));
		writeFileSync(mountPath, renderMountTemplate({ framework, channels, lang: "js" }));
		execFileSync(process.execPath, ["--check", configPath], { encoding: "utf8", stdio: "pipe" });
		execFileSync(process.execPath, ["--check", mountPath], { encoding: "utf8", stdio: "pipe" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("generated glue files (lang: js) are syntactically valid", () => {
	for (const framework of ["express", "fastify", "hono", "nextjs", "node"] as const) {
		it(`parses the ${framework} scaffold with both email and sms providers`, () => {
			expect(() => checkJsSyntax(framework, ["email", "sms"])).not.toThrow();
		});

		it(`parses the ${framework} scaffold with no extra channels`, () => {
			expect(() => checkJsSyntax(framework, [])).not.toThrow();
		});
	}
});
