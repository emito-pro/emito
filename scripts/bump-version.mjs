#!/usr/bin/env node
/**
 * scripts/bump-version.mjs — set every publishable `@emito/*` package to the
 * same version, in one pass.
 *
 * There's no changesets (or similar) in this repo — each package's "version"
 * field is an independent, hand-maintained string that happens to all read
 * "0.1.0" right now (fixed/lockstep versioning). Before tagging a release,
 * run this so all of them move together instead of drifting:
 *
 *   node scripts/bump-version.mjs 0.2.0
 *
 * "Publishable" uses the same rule as scripts/pack-release.mjs: every
 * directory under packages/ whose manifest is not `"private": true`.
 * apps/docs is intentionally out of scope — it isn't published to npm, so its
 * version field (currently 0.1.0 by coincidence) doesn't need to track this.
 *
 * Cross-package `@emito/*` dependencies use `workspace:*` ranges, which pnpm
 * rewrites to the concrete version at pack/publish time — so this script only
 * ever touches each package's own "version" field, never a dependency range.
 *
 * @module scripts/bump-version
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/;

function publishableManifests() {
	return readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(packagesDir, entry.name, "package.json"))
		.filter((manifest) => existsSync(manifest))
		.filter((manifest) => JSON.parse(readFileSync(manifest, "utf8")).private !== true)
		.sort();
}

const nextVersion = process.argv[2];
if (!nextVersion) {
	console.error("usage: bump-version.mjs <version>   e.g. bump-version.mjs 0.2.0");
	process.exit(2);
}
if (!SEMVER_PATTERN.test(nextVersion)) {
	console.error(`"${nextVersion}" doesn't look like a semver version (expected e.g. 0.2.0 or 0.2.0-beta.1)`);
	process.exit(2);
}

const manifests = publishableManifests();
if (manifests.length === 0) {
	console.error("No publishable packages found under packages/ — is the checkout complete?");
	process.exit(1);
}

// A parse-and-restringify round trip would reformat every array/object to
// JSON.stringify's own layout (e.g. collapsing multi-line arrays), touching
// far more of the file than the version bump — so this rewrites just the
// "version" line in place instead, byte-for-byte everywhere else.
const VERSION_LINE = /^(\t"version":\s*)"([^"]+)"(,?)$/m;

let changed = 0;
for (const manifestPath of manifests) {
	const raw = readFileSync(manifestPath, "utf8");
	const name = JSON.parse(raw).name;
	const match = raw.match(VERSION_LINE);
	if (!match) {
		throw new Error(`${manifestPath}: couldn't find a "version" line matching the expected format`);
	}
	const currentVersion = match[2];
	if (currentVersion === nextVersion) {
		console.log(`  ${name}@${currentVersion} (unchanged)`);
		continue;
	}
	console.log(`  ${name}: ${currentVersion} -> ${nextVersion}`);
	writeFileSync(manifestPath, raw.replace(VERSION_LINE, `$1"${nextVersion}"$3`));
	changed++;
}

console.log(`\n${changed} of ${manifests.length} package(s) updated to ${nextVersion}.`);
if (changed > 0) {
	console.log("Run `pnpm install` next so the lockfile picks up the version bump.");
}
