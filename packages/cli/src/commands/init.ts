import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spinner } from "@clack/prompts";
import { detectExistingInstall } from "../detect/existing-install.js";
import type { BackendFramework, FrontendFramework } from "../detect/framework.js";
import { detectBackendFramework, detectFrontendFramework } from "../detect/framework.js";
import { detectProjectLanguage } from "../detect/language.js";
import { detectPackageManager } from "../detect/package-manager.js";
import type { PrerequisiteEnv } from "../detect/prerequisites.js";
import { checkPrerequisites } from "../detect/prerequisites.js";
import { renderConfigTemplate } from "../generate/config-template.js";
import { renderMountTemplate } from "../generate/mount-template.js";
import { installPackages, packagesToInstall } from "../steps/install-packages.js";
import { runEmitoMigration } from "../steps/run-migration.js";
import {
	appendEnvExample,
	envTemplateBlock,
	generateApiKey,
	generateJwtSecret,
} from "../steps/write-env.js";
import type { Wizard } from "../wizard.js";
import { createClackWizard } from "../wizard.js";

export interface InitOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	channels?: Array<"email" | "sms">;
	/** Explicit backend framework — bypasses both auto-detection and the wizard. */
	framework?: BackendFramework;
	wizard?: Wizard;
}

export interface InitResult {
	status:
		| "aborted-prerequisites"
		| "aborted-existing-install"
		| "aborted-by-user"
		| "manual-mount-required";
	framework: BackendFramework | null;
	/** Detected frontend stack — `"none"` means `@emito/react` was not installed. */
	frontend?: FrontendFramework;
	generatedFiles: string[];
	/** Freshly generated `EMITO_JWT_SECRET`, printed for the user to paste into `.env`. */
	jwtSecret?: string;
	/** Freshly generated `EMITO_API_KEY`, printed for the user to paste into `.env`. */
	apiKey?: string;
	/**
	 * Populated only for `"aborted-prerequisites"`: one human-readable line per
	 * failing service, naming which one it was and — when we got that far — the
	 * underlying connection error.
	 */
	prerequisiteFailures?: string[];
}

/** Turns a failed prerequisite check into lines a user can act on. */
function describePrerequisiteFailures(result: {
	databaseUrl: string | null;
	redisUrl: string | null;
	databaseReachable: boolean;
	redisReachable: boolean;
	databaseError?: string;
	redisError?: string;
}): string[] {
	const failures: string[] = [];
	if (!result.databaseReachable) {
		failures.push(
			result.databaseUrl === null
				? "DATABASE_URL (PostgreSQL) is not set."
				: `DATABASE_URL (PostgreSQL) is unreachable${result.databaseError ? `: ${result.databaseError}` : "."}`,
		);
	}
	if (!result.redisReachable) {
		failures.push(
			result.redisUrl === null
				? "REDIS_URL (Redis) is not set."
				: `REDIS_URL (Redis) is unreachable${result.redisError ? `: ${result.redisError}` : "."}`,
		);
	}
	return failures;
}

function resolveEmitoDbMigrationsFolder(): string {
	const require = createRequire(import.meta.url);
	const dbPackageJsonPath = require.resolve("@emito/db/package.json");
	return join(dirname(dbPackageJsonPath), "drizzle");
}

/**
 * Runs `work` behind a `@clack/prompts` spinner. Always stops the spinner — a
 * spinner left running on a thrown error keeps its interval (and signal handlers)
 * alive and hides the failure behind an animation.
 *
 * `@clack/prompts`' spinner only degrades to plain output when `CI=true` — it
 * does not check `process.stdout.isTTY`, so piping output to a file (or running
 * under a CI system that doesn't set `CI=true`) would otherwise spam hundreds of
 * ANSI redraw frames for any long-running step. When we're not attached to a TTY
 * and `CI` isn't `"true"`, skip the spinner entirely and just log plain lines.
 */
async function withSpinner(
	startMessage: string,
	successMessage: string,
	failureMessage: string,
	work: () => Promise<void>,
): Promise<void> {
	if (!process.stdout.isTTY && process.env.CI !== "true") {
		console.log(startMessage);
		try {
			await work();
		} catch (error) {
			console.log(failureMessage);
			throw error;
		}
		console.log(successMessage);
		return;
	}

	const s = spinner();
	s.start(startMessage);
	try {
		await work();
	} catch (error) {
		// `.error()` renders the red failure glyph — unlike `.stop()`, which always
		// renders the green success glyph regardless of the message text.
		s.error(failureMessage);
		throw error;
	}
	s.stop(successMessage);
}

export async function runInit(options: InitOptions): Promise<InitResult> {
	const wizard = options.wizard ?? createClackWizard();

	// Cheap local checks first — fail fast before any network I/O or prompts.
	let packageJson: Record<string, unknown>;
	try {
		packageJson = JSON.parse(readFileSync(join(options.cwd, "package.json"), "utf8"));
	} catch {
		throw new Error(
			`Could not read package.json in ${options.cwd} — run emito init inside a Node.js project.`,
		);
	}

	const existing = detectExistingInstall(options.cwd);
	if (existing.configExists || existing.mountExists) {
		return { status: "aborted-existing-install", framework: null, generatedFiles: [] };
	}

	const env: PrerequisiteEnv = {
		DATABASE_URL: options.env.DATABASE_URL,
		REDIS_URL: options.env.REDIS_URL,
	};
	let prerequisites = await checkPrerequisites(env);

	let prompted = false;
	if (prerequisites.databaseUrl === null) {
		const value = (await wizard.promptMissingEnvVar("DATABASE_URL")).trim();
		if (value !== "") {
			env.DATABASE_URL = value;
			prompted = true;
		}
	}
	if (prerequisites.redisUrl === null) {
		const value = (await wizard.promptMissingEnvVar("REDIS_URL")).trim();
		if (value !== "") {
			env.REDIS_URL = value;
			prompted = true;
		}
	}
	if (prompted) {
		prerequisites = await checkPrerequisites(env);
		console.log(
			"[emito] Using the connection string(s) you entered — remember to add DATABASE_URL/REDIS_URL to your own .env, the generated files read them from the environment at runtime.",
		);
	}

	if (!prerequisites.databaseReachable || !prerequisites.redisReachable) {
		return {
			status: "aborted-prerequisites",
			framework: null,
			generatedFiles: [],
			prerequisiteFailures: describePrerequisiteFailures(prerequisites),
		};
	}

	const channels = options.channels ?? (await wizard.selectChannels());
	// Never guess an adapter silently: an explicit choice wins, otherwise try
	// detection, and only if that fails ask — suggesting the generic Node adapter.
	const detectedFramework = options.framework ?? detectBackendFramework(packageJson);
	const framework = detectedFramework ?? (await wizard.selectFramework("node"));
	// `@emito/react` is only useful when there actually is a React frontend.
	const frontend = detectFrontendFramework(packageJson);
	const packages = packagesToInstall(channels, frontend !== "none");
	const pm = detectPackageManager(options.cwd) ?? "npm";
	const lang = detectProjectLanguage(options.cwd);
	const ext = lang === "ts" ? "ts" : "js";

	const proceed = await wizard.confirmPlan(
		`Will install: ${packages.join(", ")}\nWill generate: emito.config.${ext}, emito.mount.${ext}`,
	);
	if (!proceed) {
		return { status: "aborted-by-user", framework: null, generatedFiles: [] };
	}

	// Both remaining steps are silent, multi-second waits — a spinner is the
	// difference between "working" and "hung" from the user's point of view.
	await withSpinner(
		`Installing packages with ${pm}`,
		`Installed ${packages.length} package(s) with ${pm}`,
		`Package install failed (${pm})`,
		() => installPackages(pm, options.cwd, packages),
	);

	console.log("[emito] Writing .env.example entries...");
	appendEnvExample(options.cwd, envTemplateBlock());

	// `.env.example` is meant to be committed, so it only gets an empty
	// placeholder. The live secrets are returned to the caller instead of
	// printed here, so they land in the final summary rather than scrolling
	// away behind the migration output.
	const jwtSecret = generateJwtSecret();
	const apiKey = generateApiKey();

	await withSpinner(
		"Running the Emito database migration",
		"Database migration complete",
		"Database migration failed",
		() => runEmitoMigration(prerequisites.databaseUrl as string, resolveEmitoDbMigrationsFolder()),
	);

	const generateOpts = { framework, channels, lang };
	const configPath = join(options.cwd, `emito.config.${ext}`);
	const mountPath = join(options.cwd, `emito.mount.${ext}`);
	writeFileSync(configPath, renderConfigTemplate(generateOpts));
	writeFileSync(mountPath, renderMountTemplate(generateOpts));

	return {
		status: "manual-mount-required",
		framework,
		frontend,
		generatedFiles: [configPath, mountPath],
		jwtSecret,
		apiKey,
	};
}
