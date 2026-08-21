import { createRequire } from "node:module";
import { basename } from "node:path";
import { cancel, intro, note, outro } from "@clack/prompts";
import { Command, InvalidArgumentError } from "commander";
import { installAgentSkill } from "./commands/agent-skill.js";
import type { InitOptions } from "./commands/init.js";
import { runInit } from "./commands/init.js";
import type { BackendFramework } from "./detect/framework.js";
import { createNonInteractiveWizard } from "./wizard.js";

const EXTRA_CHANNELS = ["email", "sms"] as const;
const FRAMEWORKS: readonly BackendFramework[] = ["express", "fastify", "hono", "nextjs", "node"];

/** Parses `--channels email,sms`. Exported for tests. */
export function parseChannelsOption(value: string): Array<"email" | "sms"> {
	const parsed = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
	for (const entry of parsed) {
		if (!(EXTRA_CHANNELS as readonly string[]).includes(entry)) {
			throw new InvalidArgumentError(
				`Unknown channel "${entry}". Supported: ${EXTRA_CHANNELS.join(", ")}.`,
			);
		}
	}
	return parsed as Array<"email" | "sms">;
}

/** Parses `--framework fastify`. Exported for tests. */
export function parseFrameworkOption(value: string): BackendFramework {
	if (!(FRAMEWORKS as readonly string[]).includes(value)) {
		throw new InvalidArgumentError(
			`Unknown framework "${value}". Supported: ${FRAMEWORKS.join(", ")}.`,
		);
	}
	return value as BackendFramework;
}

// Single source of truth for `--version`: the package manifest itself, so the two
// can never drift. The relative path is the same from `src/cli.ts` (vitest, source)
// and from `dist/cli.js` (built output) — both sit exactly one directory below the
// package root, and `package.json` is always part of the published tarball.
function readPackageVersion(): string {
	const require = createRequire(import.meta.url);
	const manifest = require("../package.json") as { version?: string };
	return manifest.version ?? "0.0.0";
}

export function createProgram(): Command {
	const program = new Command();
	program.name("emito").description("Emito installer CLI").version(readPackageVersion());

	program
		.command("init")
		.description("Install Emito into the current project")
		.option(
			"-y, --yes",
			"skip all prompts and take the defaults (in-app only, auto-confirm the plan); requires DATABASE_URL and REDIS_URL to already be set",
		)
		.option(
			"--channels <list>",
			`comma-separated channels beyond in-app (${EXTRA_CHANNELS.join(", ")})`,
			parseChannelsOption,
		)
		.option(
			"--framework <name>",
			`backend framework, skipping detection (${FRAMEWORKS.join(", ")})`,
			parseFrameworkOption,
		)
		.action(
			async (flags: {
				yes?: boolean;
				channels?: Array<"email" | "sms">;
				framework?: BackendFramework;
			}) => {
				intro("emito init");
				const initOptions: InitOptions = { cwd: process.cwd(), env: process.env };
				if (flags.channels !== undefined) initOptions.channels = flags.channels;
				if (flags.framework !== undefined) initOptions.framework = flags.framework;
				// `--yes` swaps in a different `Wizard` implementation rather than
				// short-circuiting past the interface `runInit` already depends on.
				if (flags.yes) initOptions.wizard = createNonInteractiveWizard();

				let result: Awaited<ReturnType<typeof runInit>>;
				try {
					result = await runInit(initOptions);
				} catch (error) {
					cancel(
						`Emito init failed: ${error instanceof Error ? error.message : String(error)}\nPackages or env changes made before the failure may need manual cleanup — check your package.json/.env.example.`,
					);
					process.exitCode = 1;
					return;
				}
				if (result.status === "aborted-prerequisites") {
					const failures = (result.prerequisiteFailures ?? []).map((line) => `  - ${line}`);
					cancel(
						[
							"Emito needs a reachable DATABASE_URL and REDIS_URL. Blocked by:",
							...failures,
							"See the docs' /prerequisites page.",
						].join("\n"),
					);
					process.exitCode = 1;
					return;
				}
				if (result.status === "aborted-existing-install") {
					cancel(
						"emito.config.(ts|js) or emito.mount.(ts|js) already exists — remove it first or run in a clean directory.",
					);
					process.exitCode = 1;
					return;
				}
				if (result.status === "aborted-by-user") {
					cancel("Cancelled — no changes made.");
					process.exitCode = 1;
					return;
				}
				const mountFileName = basename(result.generatedFiles[1] ?? "emito.mount.ts");
				console.log(`Generated: ${result.generatedFiles.join(", ")}`);
				console.log(
					`Next: mount \`mountEmito\` from ${mountFileName} in your ${result.framework} entrypoint.`,
				);
				console.log(
					`Security: the generated \`resolveWorkspaceRole\` treats every authenticated subscriber as a workspace member, so Emito's admin API stays locked. To use the admin endpoints, resolve real roles and return \`admin\` only for actual workspace admins (see ${mountFileName}).`,
				);
				if (result.frontend && result.frontend !== "none") {
					console.log(
						`Frontend: detected ${result.frontend} — installed @emito/react. See the docs' /frontend page for mounting <EmitoProvider> and <EmitoBell />.`,
					);
				}
				// Last thing on screen, deliberately: these secrets only exist in this
				// run's output, so they must not scroll away behind the install/migration
				// logs.
				if (result.jwtSecret || result.apiKey) {
					const lines = [
						result.jwtSecret ? `EMITO_JWT_SECRET=${result.jwtSecret}` : undefined,
						result.apiKey ? `EMITO_API_KEY=${result.apiKey}` : undefined,
					].filter(Boolean);
					note(lines.join("\n"), "Paste this into your real .env — do NOT commit it");
				}
				outro("Emito installed — finish by mounting `mountEmito` in your entrypoint.");
			},
		);

	program
		.command("agent-skill")
		.description("Install the Emito setup skill for AI coding agents")
		.action(() => {
			try {
				const { path, written } = installAgentSkill(process.cwd());
				console.log(
					written
						? `Installed agent skill at ${path}`
						: `Skipped: ${path} already exists — left it untouched. Delete it and re-run to take a fresh copy.`,
				);
			} catch (error) {
				console.error(
					`Failed to install agent skill: ${error instanceof Error ? error.message : String(error)}`,
				);
				process.exitCode = 1;
				return;
			}
		});

	return program;
}
