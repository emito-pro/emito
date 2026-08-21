import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectExistingInstall } from "../detect/existing-install.js";

describe("detectExistingInstall", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "emito-cli-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("reports both false on an empty directory", () => {
		expect(detectExistingInstall(dir)).toEqual({ configExists: false, mountExists: false });
	});

	it("detects an existing emito.config.ts", () => {
		writeFileSync(join(dir, "emito.config.ts"), "");
		expect(detectExistingInstall(dir)).toEqual({ configExists: true, mountExists: false });
	});

	it("detects an existing emito.config.js and emito.mount.js", () => {
		writeFileSync(join(dir, "emito.config.js"), "");
		writeFileSync(join(dir, "emito.mount.js"), "");
		expect(detectExistingInstall(dir)).toEqual({ configExists: true, mountExists: true });
	});
});
