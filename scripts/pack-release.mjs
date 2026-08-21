#!/usr/bin/env node
/**
 * scripts/pack-release.mjs — pack every publishable `@emito/*` package into
 * `dist-tarballs/`.
 *
 * These are the tarballs attached to a GitHub Release, so consumers can install
 * Emito before the packages exist on a registry (see the docs site's Install
 * page). The release workflow runs this after `pnpm build`; run it locally the
 * same way to inspect what a release would contain:
 *
 *   pnpm build && node scripts/pack-release.mjs
 *
 * "Publishable" means every directory under `packages/` whose manifest is not
 * `"private": true` — the demo app and the docs site are excluded by that rule
 * alone, so adding a package needs no edit here.
 *
 * After packing, each tarball's own manifest is checked for surviving
 * `workspace:` ranges. pnpm rewrites them to concrete versions while packing;
 * if one ever slipped through, the published package would be uninstallable
 * outside this repo — so that is a hard failure, not a warning.
 *
 * @module scripts/pack-release
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");
const outDir = join(repoRoot, "dist-tarballs");

/** @returns {{name: string, dir: string, version: string}[]} */
function publishablePackages() {
	return readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			dir: join(packagesDir, entry.name),
			manifest: join(packagesDir, entry.name, "package.json"),
		}))
		.filter((pkg) => existsSync(pkg.manifest))
		.map((pkg) => ({ ...pkg, json: JSON.parse(readFileSync(pkg.manifest, "utf8")) }))
		.filter((pkg) => pkg.json.private !== true)
		.map((pkg) => ({ name: pkg.json.name, dir: pkg.dir, version: pkg.json.version }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Reads `package/package.json` back out of a packed tarball. */
function manifestFromTarball(tarball) {
	const raw = execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" });
	return JSON.parse(raw);
}

function assertNoWorkspaceRanges(name, manifest) {
	const offenders = [];
	for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
		for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
			if (typeof range === "string" && range.startsWith("workspace:")) {
				offenders.push(`${field}.${dep} = ${range}`);
			}
		}
	}
	if (offenders.length > 0) {
		throw new Error(
			`${name} packed with unresolved workspace ranges — the tarball would not ` +
				`install outside this repo:\n  ${offenders.join("\n  ")}`,
		);
	}
}

const packages = publishablePackages();
if (packages.length === 0) {
	console.error("No publishable packages found under packages/ — is the checkout complete?");
	process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(`Packing ${packages.length} package(s) into dist-tarballs/\n`);

for (const pkg of packages) {
	process.stdout.write(`  ${pkg.name}@${pkg.version} … `);
	// `pnpm pack` runs the package's own prepack hook and rewrites `workspace:*`
	// to the concrete version.
	execFileSync("pnpm", ["pack", "--pack-destination", outDir], { cwd: pkg.dir, stdio: "pipe" });
	const tarball = join(outDir, `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`);
	if (!existsSync(tarball)) {
		throw new Error(`expected ${tarball} after packing ${pkg.name}, but it is missing`);
	}
	assertNoWorkspaceRanges(pkg.name, manifestFromTarball(tarball));
	console.log("ok");
}

console.log(`\nDone — ${packages.length} tarball(s) in dist-tarballs/`);
