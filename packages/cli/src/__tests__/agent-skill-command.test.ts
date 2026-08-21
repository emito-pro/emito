import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAgentSkill } from "../commands/agent-skill.js";

describe("installAgentSkill", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "emito-cli-skill-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("copies SKILL.md into .claude/skills/emito-init/", () => {
		const result = installAgentSkill(dir);
		expect(result.path).toBe(join(dir, ".claude", "skills", "emito-init", "SKILL.md"));
		expect(result.written).toBe(true);
		expect(existsSync(result.path)).toBe(true);
		expect(readFileSync(result.path, "utf8")).toContain("emito init");
	});

	it("never silently overwrites an existing SKILL.md", () => {
		// Same principle `emito init` follows: the CLI does not clobber files it did
		// not write — the user may have edited this one.
		const destDir = join(dir, ".claude", "skills", "emito-init");
		mkdirSync(destDir, { recursive: true });
		const dest = join(destDir, "SKILL.md");
		writeFileSync(dest, "# my own edited skill");

		const result = installAgentSkill(dir);

		expect(result.written).toBe(false);
		expect(result.path).toBe(dest);
		expect(readFileSync(dest, "utf8")).toBe("# my own edited skill");
	});
});
