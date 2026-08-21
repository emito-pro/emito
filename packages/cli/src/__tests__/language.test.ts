import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProjectLanguage } from "../detect/language.js";

describe("detectProjectLanguage", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "emito-cli-lang-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns js when there is no tsconfig.json", () => {
		expect(detectProjectLanguage(dir)).toBe("js");
	});

	it("returns ts when a tsconfig.json is present", () => {
		writeFileSync(join(dir, "tsconfig.json"), "{}");
		expect(detectProjectLanguage(dir)).toBe("ts");
	});
});
