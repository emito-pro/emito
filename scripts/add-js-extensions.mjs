#!/usr/bin/env node
/**
 * Rewrite extensionless relative import/export specifiers in a compiled `dist/`
 * to explicit `./foo.js` / `./foo/index.js`, making the emitted ESM importable
 * by Node and any spec-compliant ESM resolver.
 *
 * Why this exists: several `@emito/*` packages compile with TypeScript's
 * `moduleResolution: "bundler"`, under which extensionless relative specifiers
 * in source (`from "./emito"`) are *preserved verbatim* in the emit. That is
 * fine when a bundler consumes the package, but Node's ESM loader requires a
 * full path with an extension — so the published `dist/index.js` is otherwise
 * un-importable (`ERR_MODULE_NOT_FOUND`). Rather than touch ~150 source files
 * across the foundational packages (and risk the whole repo's type-check), this
 * post-`build` step fixes only the *emitted* artifacts, leaving source and the
 * `bundler` resolution mode untouched.
 *
 * The rewrite is filesystem-aware (not a blind regex): for each relative
 * specifier `S` resolved against the emitting file's directory it picks
 *   - `S.js`        when `<S>.js` exists, else
 *   - `S/index.js`  when `<S>/index.js` exists,
 * and leaves anything already carrying an extension (`.js`, `.json`, `.css`, …)
 * or any bare/scoped package specifier alone. Both `*.js` and `*.d.ts` emit are
 * rewritten so the runtime and the shipped declarations stay consistent.
 *
 * Usage:  node scripts/add-js-extensions.mjs <dist-dir> [<dist-dir> …]
 *
 * Idempotent: re-running over an already-fixed `dist/` is a no-op (every
 * specifier already has an extension). Exit code is non-zero if a relative
 * specifier resolves to neither a file nor a directory index (a real bug — fail
 * loudly rather than ship a dangling import).
 *
 * @module scripts/add-js-extensions
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Matches a relative import/export `from "..."` or a dynamic `import("...")`
 * specifier. Group 1 = the quote, group 2 = the relative specifier body.
 */
const SPEC_RE = /(from\s*|import\s*\(\s*)(["'])(\.\.?\/[^"']*)\2/g;

/** Extensions that mean "already explicit — leave it alone". */
const HAS_EXT = /\.(js|mjs|cjs|json|node|css|svg|wasm)$/;

/** Resolve which suffix (`.js` or `/index.js`) the specifier needs, or null. */
function resolveSuffix(fileDir, spec) {
	if (HAS_EXT.test(spec)) return spec; // already explicit
	const abs = resolve(fileDir, spec);
	if (existsSync(`${abs}.js`)) return `${spec}.js`;
	if (existsSync(join(abs, "index.js"))) return `${spec}/index.js`;
	return null;
}

/** Same as {@link resolveSuffix} but for `.d.ts` emit (probe `.d.ts`/index.d.ts). */
function resolveSuffixDts(fileDir, spec) {
	if (HAS_EXT.test(spec)) return spec;
	const abs = resolve(fileDir, spec);
	// In .d.ts we still write a `.js` specifier (TS resolves the sibling .d.ts).
	if (existsSync(`${abs}.d.ts`) || existsSync(`${abs}.js`)) return `${spec}.js`;
	if (existsSync(join(abs, "index.d.ts")) || existsSync(join(abs, "index.js"))) {
		return `${spec}/index.js`;
	}
	return null;
}

/** Recursively yield every `.js` / `.d.ts` file under `dir`. */
function* walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(full);
		} else if (entry.isFile() && (full.endsWith(".js") || full.endsWith(".d.ts"))) {
			yield full;
		}
	}
}

let totalFixed = 0;
let totalFiles = 0;
const errors = [];

const distDirs = process.argv.slice(2);
if (distDirs.length === 0) {
	console.error("usage: add-js-extensions.mjs <dist-dir> [<dist-dir> …]");
	process.exit(1);
}

for (const distArg of distDirs) {
	const dist = resolve(distArg);
	if (!existsSync(dist) || !statSync(dist).isDirectory()) {
		console.error(`[add-js-extensions] not a directory: ${dist}`);
		process.exit(1);
	}
	for (const file of walk(dist)) {
		const isDts = file.endsWith(".d.ts");
		const fileDir = dirname(file);
		const source = readFileSync(file, "utf-8");
		let fixedInFile = 0;
		const out = source.replace(SPEC_RE, (match, lead, quote, spec) => {
			const resolved = isDts ? resolveSuffixDts(fileDir, spec) : resolveSuffix(fileDir, spec);
			if (resolved === null) {
				errors.push(`${file}: cannot resolve relative specifier "${spec}"`);
				return match;
			}
			if (resolved === spec) return match; // already explicit
			fixedInFile += 1;
			return `${lead}${quote}${resolved}${quote}`;
		});
		if (fixedInFile > 0) {
			writeFileSync(file, out);
			totalFixed += fixedInFile;
			totalFiles += 1;
		}
	}
}

if (errors.length > 0) {
	console.error(`[add-js-extensions] ${errors.length} unresolved specifier(s):`);
	for (const e of errors.slice(0, 20)) console.error(`  - ${e}`);
	process.exit(1);
}

console.log(
	`[add-js-extensions] rewrote ${totalFixed} specifier(s) across ${totalFiles} file(s) in ${distDirs.length} dist dir(s).`,
);
