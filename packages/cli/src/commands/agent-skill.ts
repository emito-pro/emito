import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface InstallAgentSkillResult {
	/** Where the skill lives (whether or not this call wrote it). */
	path: string;
	/** `false` when a file was already there and was left untouched. */
	written: boolean;
}

/**
 * Copies the bundled `SKILL.md` into `.claude/skills/emito-init/`.
 *
 * Never overwrites: an existing file may have been edited by the user, and
 * `emito init` already holds the line that this CLI does not clobber files it
 * did not write. Since this is a static template rather than user data, skipping
 * with a message is enough — no interactive prompt needed. Delete the file and
 * re-run to take a fresh copy.
 */
export function installAgentSkill(cwd: string): InstallAgentSkillResult {
	const templatePath = fileURLToPath(new URL("../../skill-template/SKILL.md", import.meta.url));
	const destDir = join(cwd, ".claude", "skills", "emito-init");
	const dest = join(destDir, "SKILL.md");

	if (existsSync(dest)) {
		return { path: dest, written: false };
	}

	mkdirSync(destDir, { recursive: true });
	copyFileSync(templatePath, dest);
	return { path: dest, written: true };
}
