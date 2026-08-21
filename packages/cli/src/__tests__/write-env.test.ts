import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEnvExample, envTemplateBlock, generateJwtSecret } from "../steps/write-env.js";

describe("appendEnvExample", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "emito-cli-env-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("creates .env.example when absent", () => {
		appendEnvExample(dir, envTemplateBlock());
		const contents = readFileSync(join(dir, ".env.example"), "utf8");
		expect(contents).toContain("EMITO_JWT_SECRET=");
		expect(contents).toContain("EMITO_API_KEY=");
	});

	it("appends to an existing .env.example without truncating it", () => {
		writeFileSync(join(dir, ".env.example"), "EXISTING_VAR=1\n");
		appendEnvExample(dir, envTemplateBlock());
		const contents = readFileSync(join(dir, ".env.example"), "utf8");
		expect(contents).toContain("EXISTING_VAR=1");
		expect(contents).toContain("EMITO_JWT_SECRET=");
	});

	it("is idempotent — does not duplicate the block on a second call", () => {
		appendEnvExample(dir, envTemplateBlock());
		appendEnvExample(dir, envTemplateBlock());
		const contents = readFileSync(join(dir, ".env.example"), "utf8");
		const occurrences = contents.split("EMITO_JWT_SECRET=").length - 1;
		expect(occurrences).toBe(1);
	});

	it("never writes a live secret into the committed .env.example", () => {
		appendEnvExample(dir, envTemplateBlock());
		const contents = readFileSync(join(dir, ".env.example"), "utf8");
		expect(contents).toContain("EMITO_JWT_SECRET=\n");
		expect(contents).not.toMatch(/EMITO_JWT_SECRET=[0-9a-f]{8,}/);
	});
});

describe("generateJwtSecret", () => {
	it("returns a fresh 32-byte hex secret each call", () => {
		const first = generateJwtSecret();
		const second = generateJwtSecret();
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(second).not.toBe(first);
	});
});
