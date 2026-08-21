import { existsSync } from "node:fs";
import { join } from "node:path";

export type ProjectLanguage = "ts" | "js";

/**
 * A project is treated as TypeScript only when it has its own `tsconfig.json` —
 * a `typescript` devDependency alone doesn't mean the entrypoint the generated
 * files get mounted into is `.ts` (it could be there only for editor
 * type-checking of `.js` via JSDoc). `tsconfig.json` presence is the direct
 * signal that `.ts` files in this project are actually compiled/run as such.
 */
export function detectProjectLanguage(cwd: string): ProjectLanguage {
	return existsSync(join(cwd, "tsconfig.json")) ? "ts" : "js";
}
