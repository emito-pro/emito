import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ExistingInstall {
	configExists: boolean;
	mountExists: boolean;
}

export function detectExistingInstall(targetDir: string): ExistingInstall {
	return {
		configExists:
			existsSync(join(targetDir, "emito.config.ts")) ||
			existsSync(join(targetDir, "emito.config.js")),
		mountExists:
			existsSync(join(targetDir, "emito.mount.ts")) ||
			existsSync(join(targetDir, "emito.mount.js")),
	};
}
