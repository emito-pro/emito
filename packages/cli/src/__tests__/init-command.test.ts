import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPrerequisites } from "../detect/prerequisites.js";
import { installPackages, packagesToInstall } from "../steps/install-packages.js";
import { runEmitoMigration } from "../steps/run-migration.js";
import { appendEnvExample } from "../steps/write-env.js";

vi.mock("../detect/prerequisites.js", () => ({
	checkPrerequisites: vi.fn().mockResolvedValue({
		databaseUrl: null,
		redisUrl: null,
		databaseReachable: false,
		redisReachable: false,
	}),
}));

vi.mock("../steps/install-packages.js", () => ({
	installPackages: vi.fn().mockResolvedValue(undefined),
	packagesToInstall: vi
		.fn()
		.mockReturnValue([
			"@emito/core",
			"@emito/server",
			"@emito/db",
			"@emito/auth-jwt",
			"@emito/react",
		]),
}));

vi.mock("../steps/write-env.js", () => ({
	appendEnvExample: vi.fn(),
	envTemplateBlock: vi.fn().mockReturnValue("\n# --- Emito ---\nEMITO_JWT_SECRET=\n"),
	generateJwtSecret: vi.fn().mockReturnValue("deadbeef".repeat(8)),
	generateApiKey: vi.fn().mockReturnValue("cafebabe".repeat(6)),
}));

vi.mock("../steps/run-migration.js", () => ({
	runEmitoMigration: vi.fn().mockResolvedValue(undefined),
}));

const spinnerInstance = {
	start: vi.fn(),
	stop: vi.fn(),
	error: vi.fn(),
	message: vi.fn(),
};
const spinnerFactory = vi.fn().mockReturnValue(spinnerInstance);
vi.mock("@clack/prompts", () => ({
	spinner: spinnerFactory,
}));

const fakeWizard = {
	selectChannels: vi.fn().mockResolvedValue([]),
	promptMissingEnvVar: vi.fn().mockResolvedValue(""),
	selectFramework: vi.fn().mockResolvedValue("node"),
	confirmPlan: vi.fn().mockResolvedValue(true),
};

describe("runInit", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "emito-cli-init-"));
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ dependencies: { fastify: "^5.0.0" } }),
		);
		writeFileSync(join(dir, "pnpm-lock.yaml"), "");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("aborts before writing anything when prerequisites are unreachable", async () => {
		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

		expect(result.status).toBe("aborted-prerequisites");
		expect(result.generatedFiles).toEqual([]);
	});

	it("names which service blocked the run, with the underlying error when there is one", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://nope:5432/test",
			redisUrl: null,
			databaseReachable: false,
			redisReachable: false,
			databaseError: "ECONNREFUSED 127.0.0.1:5432",
		});

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({
			cwd: dir,
			env: { DATABASE_URL: "postgres://nope:5432/test" },
			channels: [],
			wizard: fakeWizard,
		});

		expect(result.status).toBe("aborted-prerequisites");
		expect(result.prerequisiteFailures).toEqual([
			"DATABASE_URL (PostgreSQL) is unreachable: ECONNREFUSED 127.0.0.1:5432",
			// A URL that was never set is reported as missing, not as a failed connection.
			"REDIS_URL (Redis) is not set.",
		]);
	});

	it("prompts for a missing DATABASE_URL/REDIS_URL and proceeds once they are supplied", async () => {
		vi.mocked(checkPrerequisites)
			.mockResolvedValueOnce({
				databaseUrl: null,
				redisUrl: null,
				databaseReachable: false,
				redisReachable: false,
			})
			.mockResolvedValueOnce({
				databaseUrl: "postgres://localhost:5432/test",
				redisUrl: "redis://localhost:6379",
				databaseReachable: true,
				redisReachable: true,
			});
		const promptingWizard = {
			...fakeWizard,
			promptMissingEnvVar: vi
				.fn()
				.mockResolvedValueOnce("postgres://localhost:5432/test")
				.mockResolvedValueOnce("redis://localhost:6379"),
		};

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: promptingWizard });

		expect(promptingWizard.promptMissingEnvVar).toHaveBeenCalledWith("DATABASE_URL");
		expect(promptingWizard.promptMissingEnvVar).toHaveBeenCalledWith("REDIS_URL");
		expect(checkPrerequisites).toHaveBeenCalledTimes(2);
		expect(checkPrerequisites).toHaveBeenLastCalledWith({
			DATABASE_URL: "postgres://localhost:5432/test",
			REDIS_URL: "redis://localhost:6379",
		});
		expect(result.status).toBe("manual-mount-required");
	});

	it("aborts without prompting when the URLs are set but unreachable", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://nope:5432/test",
			redisUrl: "redis://nope:6379",
			databaseReachable: false,
			redisReachable: false,
		});

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({
			cwd: dir,
			env: { DATABASE_URL: "postgres://nope:5432/test", REDIS_URL: "redis://nope:6379" },
			channels: [],
			wizard: fakeWizard,
		});

		expect(result.status).toBe("aborted-prerequisites");
		expect(fakeWizard.promptMissingEnvVar).not.toHaveBeenCalled();
		expect(installPackages).not.toHaveBeenCalled();
	});

	it("aborts before installing/writing anything when emito is already installed", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});
		writeFileSync(join(dir, "emito.config.ts"), "// already installed");

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

		expect(result.status).toBe("aborted-existing-install");
		expect(result.generatedFiles).toEqual([]);
		expect(installPackages).not.toHaveBeenCalled();
		expect(appendEnvExample).not.toHaveBeenCalled();
		expect(runEmitoMigration).not.toHaveBeenCalled();
		expect(existsSync(join(dir, "emito.mount.ts"))).toBe(false);
	});

	it("aborts before installing/writing anything when the user declines the plan", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});
		const decliningWizard = {
			selectChannels: vi.fn().mockResolvedValue([]),
			promptMissingEnvVar: vi.fn().mockResolvedValue(""),
			selectFramework: vi.fn().mockResolvedValue("node"),
			confirmPlan: vi.fn().mockResolvedValue(false),
		};

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: decliningWizard });

		expect(result.status).toBe("aborted-by-user");
		expect(result.generatedFiles).toEqual([]);
		expect(installPackages).not.toHaveBeenCalled();
		expect(appendEnvExample).not.toHaveBeenCalled();
		expect(runEmitoMigration).not.toHaveBeenCalled();
		expect(existsSync(join(dir, "emito.mount.ts"))).toBe(false);
	});

	it("installs packages, writes env, migrates, and generates config/mount files on the happy path", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

		expect(result.status).toBe("manual-mount-required");
		expect(result.framework).toBe("fastify");

		expect(installPackages).toHaveBeenCalledTimes(1);
		expect(installPackages).toHaveBeenCalledWith(
			"pnpm",
			dir,
			expect.arrayContaining(["@emito/core", "@emito/server"]),
		);
		expect(appendEnvExample).toHaveBeenCalledTimes(1);
		expect(runEmitoMigration).toHaveBeenCalledTimes(1);

		// No tsconfig.json in the fixture, so the project is treated as plain JS —
		// see the "TypeScript project" test below for the .ts branch.
		const configPath = join(dir, "emito.config.js");
		const mountPath = join(dir, "emito.mount.js");
		expect(result.generatedFiles).toEqual([configPath, mountPath]);
		expect(existsSync(configPath)).toBe(true);
		expect(existsSync(mountPath)).toBe(true);
		expect(readFileSync(configPath, "utf8").length).toBeGreaterThan(0);
		expect(readFileSync(mountPath, "utf8").length).toBeGreaterThan(0);
		// No leftover TypeScript syntax in the JS output.
		expect(readFileSync(configPath, "utf8")).not.toContain("satisfies");
		expect(readFileSync(mountPath, "utf8")).not.toMatch(/:\s*EmitoServer/);
	});

	it("generates .ts files when the project has a tsconfig.json", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});
		writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

		const configPath = join(dir, "emito.config.ts");
		const mountPath = join(dir, "emito.mount.ts");
		expect(result.generatedFiles).toEqual([configPath, mountPath]);
		expect(existsSync(configPath)).toBe(true);
		expect(existsSync(mountPath)).toBe(true);
		expect(readFileSync(mountPath, "utf8")).toContain(": EmitoServer");
	});

	it("asks which adapter to use when no backend framework is detected", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});
		writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
		const choosingWizard = {
			...fakeWizard,
			selectFramework: vi.fn().mockResolvedValue("express"),
		};

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: choosingWizard });

		expect(choosingWizard.selectFramework).toHaveBeenCalledWith("node");
		expect(result.framework).toBe("express");
	});

	it("uses an explicitly supplied framework over detection and the wizard", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});
		// The fixture package.json declares fastify — the explicit choice must win.
		const { runInit } = await import("../commands/init.js");
		const result = await runInit({
			cwd: dir,
			env: {},
			channels: [],
			framework: "nextjs",
			wizard: fakeWizard,
		});

		expect(result.framework).toBe("nextjs");
		expect(fakeWizard.selectFramework).not.toHaveBeenCalled();
		expect(readFileSync(join(dir, "emito.mount.js"), "utf8")).toContain(
			'from "@emito/server/nextjs"',
		);
	});

	it("does not ask about the adapter when the framework is detected", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

		expect(result.framework).toBe("fastify");
		expect(fakeWizard.selectFramework).not.toHaveBeenCalled();
	});

	it("skips @emito/react when no frontend framework is detected", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

		expect(result.frontend).toBe("none");
		expect(packagesToInstall).toHaveBeenCalledWith([], false);
	});

	it("installs @emito/react and reports the frontend when React is detected", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ dependencies: { fastify: "^5.0.0", react: "^19.0.0", vite: "^6.0.0" } }),
		);

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

		expect(result.frontend).toBe("react-vite");
		expect(packagesToInstall).toHaveBeenCalledWith([], true);
	});

	it("returns the generated JWT secret instead of printing it mid-run", async () => {
		vi.mocked(checkPrerequisites).mockResolvedValueOnce({
			databaseUrl: "postgres://localhost:5432/test",
			redisUrl: "redis://localhost:6379",
			databaseReachable: true,
			redisReachable: true,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const { runInit } = await import("../commands/init.js");
		const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

		// The secret is never written to `.env.example` (that file is committed), so
		// this run's output is the only place the user can get it. It therefore has to
		// live in the *final* summary — printing it here would bury it behind the
		// install/migration output.
		expect(result.jwtSecret).toBe("deadbeef".repeat(8));
		const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(printed).not.toContain("deadbeef".repeat(8));
		logSpy.mockRestore();
	});

	describe("withSpinner TTY behavior", () => {
		let originalIsTTY: boolean | undefined;
		let originalCI: string | undefined;

		beforeEach(() => {
			originalIsTTY = process.stdout.isTTY;
			originalCI = process.env.CI;
			vi.mocked(checkPrerequisites).mockResolvedValueOnce({
				databaseUrl: "postgres://localhost:5432/test",
				redisUrl: "redis://localhost:6379",
				databaseReachable: true,
				redisReachable: true,
			});
		});

		afterEach(() => {
			Object.defineProperty(process.stdout, "isTTY", {
				value: originalIsTTY,
				configurable: true,
			});
			if (originalCI === undefined) Reflect.deleteProperty(process.env, "CI");
			else process.env.CI = originalCI;
		});

		it("skips the clack spinner and logs plain lines when stdout is not a TTY and CI isn't 'true'", async () => {
			Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
			Reflect.deleteProperty(process.env, "CI");
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const { runInit } = await import("../commands/init.js");
			const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

			expect(result.status).toBe("manual-mount-required");
			expect(spinnerFactory).not.toHaveBeenCalled();
			const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
			expect(printed).toContain("Installing packages with pnpm");
			expect(printed).toContain("Installed");
			expect(printed).toContain("Database migration complete");
			logSpy.mockRestore();
		});

		it("uses the clack spinner when stdout is a TTY", async () => {
			Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
			Reflect.deleteProperty(process.env, "CI");

			const { runInit } = await import("../commands/init.js");
			const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

			expect(result.status).toBe("manual-mount-required");
			expect(spinnerFactory).toHaveBeenCalled();
			expect(spinnerInstance.start).toHaveBeenCalledWith("Installing packages with pnpm");
			expect(spinnerInstance.stop).toHaveBeenCalled();
		});

		it("uses the clack spinner when CI is 'true' even without a TTY", async () => {
			Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
			process.env.CI = "true";

			const { runInit } = await import("../commands/init.js");
			const result = await runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard });

			expect(result.status).toBe("manual-mount-required");
			expect(spinnerFactory).toHaveBeenCalled();
		});

		it("calls the spinner's error method (not stop) on a failed step, without a hand-typed glyph", async () => {
			Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
			Reflect.deleteProperty(process.env, "CI");
			vi.mocked(installPackages).mockRejectedValueOnce(new Error("boom"));

			const { runInit } = await import("../commands/init.js");
			await expect(
				runInit({ cwd: dir, env: {}, channels: [], wizard: fakeWizard }),
			).rejects.toThrow("boom");

			expect(spinnerInstance.error).toHaveBeenCalledWith("Package install failed (pnpm)");
			expect(spinnerInstance.stop).not.toHaveBeenCalled();
		});
	});
});
