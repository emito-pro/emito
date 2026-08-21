import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectBackendFramework, detectFrontendFramework } from "../detect/framework.js";
import { detectPackageManager } from "../detect/package-manager.js";

describe("detectBackendFramework", () => {
	it("detects fastify", () => {
		expect(detectBackendFramework({ dependencies: { fastify: "^5.0.0" } })).toBe("fastify");
	});

	it("detects hono", () => {
		expect(detectBackendFramework({ dependencies: { hono: "^4.0.0" } })).toBe("hono");
	});

	it("detects express", () => {
		expect(detectBackendFramework({ dependencies: { express: "^4.0.0" } })).toBe("express");
	});

	it("detects next as the backend framework when present", () => {
		expect(detectBackendFramework({ dependencies: { next: "^15.0.0" } })).toBe("nextjs");
	});

	it("returns null when nothing recognized is present", () => {
		expect(detectBackendFramework({ dependencies: { koa: "^2.0.0" } })).toBeNull();
	});
});

describe("detectFrontendFramework", () => {
	it("detects react + vite", () => {
		expect(
			detectFrontendFramework({
				dependencies: { react: "^18.0.0" },
				devDependencies: { vite: "^5.0.0" },
			}),
		).toBe("react-vite");
	});

	it("detects react + next", () => {
		expect(detectFrontendFramework({ dependencies: { react: "^18.0.0", next: "^15.0.0" } })).toBe(
			"react-next",
		);
	});

	it("returns none without react", () => {
		expect(detectFrontendFramework({ dependencies: {} })).toBe("none");
	});
});

describe("detectPackageManager", () => {
	let tempDir: string;

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("detects pnpm when pnpm-lock.yaml exists", () => {
		tempDir = mkdtempSync(join(tmpdir(), "emito-test-"));
		writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
		expect(detectPackageManager(tempDir)).toBe("pnpm");
	});

	it("detects yarn when yarn.lock exists", () => {
		tempDir = mkdtempSync(join(tmpdir(), "emito-test-"));
		writeFileSync(join(tempDir, "yarn.lock"), "");
		expect(detectPackageManager(tempDir)).toBe("yarn");
	});

	it("detects npm when package-lock.json exists", () => {
		tempDir = mkdtempSync(join(tmpdir(), "emito-test-"));
		writeFileSync(join(tempDir, "package-lock.json"), "");
		expect(detectPackageManager(tempDir)).toBe("npm");
	});

	it("returns null when no lockfile exists", () => {
		tempDir = mkdtempSync(join(tmpdir(), "emito-test-"));
		expect(detectPackageManager(tempDir)).toBeNull();
	});

	it("prioritizes pnpm over yarn when both exist", () => {
		tempDir = mkdtempSync(join(tmpdir(), "emito-test-"));
		writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
		writeFileSync(join(tempDir, "yarn.lock"), "");
		expect(detectPackageManager(tempDir)).toBe("pnpm");
	});

	it("prioritizes yarn over npm when both exist", () => {
		tempDir = mkdtempSync(join(tmpdir(), "emito-test-"));
		writeFileSync(join(tempDir, "yarn.lock"), "");
		writeFileSync(join(tempDir, "package-lock.json"), "");
		expect(detectPackageManager(tempDir)).toBe("yarn");
	});

	it("prioritizes pnpm over npm when both exist", () => {
		tempDir = mkdtempSync(join(tmpdir(), "emito-test-"));
		writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
		writeFileSync(join(tempDir, "package-lock.json"), "");
		expect(detectPackageManager(tempDir)).toBe("pnpm");
	});

	it("prioritizes pnpm when all three lockfiles exist", () => {
		tempDir = mkdtempSync(join(tmpdir(), "emito-test-"));
		writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
		writeFileSync(join(tempDir, "yarn.lock"), "");
		writeFileSync(join(tempDir, "package-lock.json"), "");
		expect(detectPackageManager(tempDir)).toBe("pnpm");
	});
});
