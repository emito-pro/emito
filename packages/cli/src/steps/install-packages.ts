import { execa } from "execa";
import type { PackageManager } from "../detect/package-manager.js";

/**
 * @param includeReact whether to install `@emito/react` — only useful when a
 *   React frontend was actually detected (defaults to `true` for callers that
 *   don't know).
 */
export function packagesToInstall(channels: Array<"email" | "sms">, includeReact = true): string[] {
	// "ioredis" is a direct import in the generated emito.config.ts (not just a
	// transitive dependency of @emito/core) — under pnpm's strict node_modules,
	// a bare "ioredis" import fails to resolve unless it's a direct dependency
	// of the consumer project too. "@emito/js" is the framework-agnostic client
	// the skill wires by hand (bell/inbox/preferences) whenever no React
	// frontend was detected — it's a transitive dependency of @emito/react but
	// not of anything else installed here, so it needs the same direct-install
	// treatment or that hand-written import fails to resolve under pnpm too.
	const packages = [
		"@emito/core",
		"@emito/server",
		"@emito/db",
		"@emito/auth-jwt",
		"@emito/js",
		"ioredis",
	];
	if (includeReact) packages.push("@emito/react");
	if (channels.includes("email")) packages.push("@emito/provider-resend");
	if (channels.includes("sms")) packages.push("@emito/provider-smsapi");
	return packages;
}

interface ExecaLikeError {
	exitCode?: number;
	stdout?: string;
	stderr?: string;
}

function isPnpmIgnoredBuildsFailure(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const { exitCode, stdout, stderr } = error as ExecaLikeError;
	if (exitCode !== 1) return false;
	const output = `${stdout ?? ""}${stderr ?? ""}`;
	return output.includes("ERR_PNPM_IGNORED_BUILDS");
}

export async function installPackages(
	pm: PackageManager,
	cwd: string,
	packages: string[],
): Promise<void> {
	const command = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm";
	const args = pm === "npm" ? ["install", ...packages] : ["add", ...packages];
	try {
		await execa(command, args, { cwd });
	} catch (error) {
		// pnpm's supply-chain-policy guard exits 1 when a (transitive) dependency
		// has an unapproved postinstall script — e.g. esbuild, pulled in by
		// several @emito/* packages' own build tooling. The dependency graph
		// itself is still updated correctly (package.json/lockfile), only the
		// native build step for that dependency was skipped. Treat this as a
		// warning, not a fatal install failure — the user can run
		// `pnpm approve-builds` (or add an `onlyBuiltDependencies` entry) later
		// if they need that dependency's native build.
		if (pm === "pnpm" && isPnpmIgnoredBuildsFailure(error)) {
			console.log(
				"[emito] pnpm skipped a dependency's build script (supply-chain policy) — packages installed" +
					" fine. Run `pnpm approve-builds` if you need that dependency's native build.",
			);
			return;
		}
		throw error;
	}
}
