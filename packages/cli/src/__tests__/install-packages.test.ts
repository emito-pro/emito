import { describe, expect, it, vi } from "vitest";
import { installPackages, packagesToInstall } from "../steps/install-packages.js";

vi.mock("execa", () => ({ execa: vi.fn().mockResolvedValue({}) }));

describe("packagesToInstall", () => {
	it("always includes core packages", () => {
		const packages = packagesToInstall([]);
		expect(packages).toEqual(
			expect.arrayContaining([
				"@emito/core",
				"@emito/server",
				"@emito/db",
				"@emito/auth-jwt",
				"@emito/react",
			]),
		);
	});

	it("always includes ioredis (a direct import in the generated config)", () => {
		expect(packagesToInstall([])).toContain("ioredis");
		expect(packagesToInstall([], false)).toContain("ioredis");
	});

	it("omits @emito/react when no frontend framework was detected", () => {
		const packages = packagesToInstall([], false);
		expect(packages).not.toContain("@emito/react");
		expect(packages).toEqual(
			expect.arrayContaining(["@emito/core", "@emito/server", "@emito/db", "@emito/auth-jwt"]),
		);
	});

	it("adds provider-resend for email", () => {
		expect(packagesToInstall(["email"])).toContain("@emito/provider-resend");
	});

	it("adds provider-smsapi for sms", () => {
		expect(packagesToInstall(["sms"])).toContain("@emito/provider-smsapi");
	});
});

describe("installPackages", () => {
	it("runs pnpm add with the given packages", async () => {
		const { execa } = await import("execa");
		await installPackages("pnpm", "/tmp/project", ["@emito/core"]);
		expect(execa).toHaveBeenCalledWith("pnpm", ["add", "@emito/core"], { cwd: "/tmp/project" });
	});

	it("runs npm install for npm", async () => {
		const { execa } = await import("execa");
		await installPackages("npm", "/tmp/project", ["@emito/core"]);
		expect(execa).toHaveBeenCalledWith("npm", ["install", "@emito/core"], { cwd: "/tmp/project" });
	});

	it("runs yarn add for yarn", async () => {
		const { execa } = await import("execa");
		await installPackages("yarn", "/tmp/project", ["@emito/core"]);
		expect(execa).toHaveBeenCalledWith("yarn", ["add", "@emito/core"], { cwd: "/tmp/project" });
	});

	it("does not throw when pnpm exits 1 only because a build script was ignored", async () => {
		const { execa } = await import("execa");
		vi.mocked(execa).mockRejectedValueOnce(
			Object.assign(new Error("Command failed with exit code 1"), {
				exitCode: 1,
				stdout:
					"dependencies:\n+ @emito/core 0.1.0\n\n[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1",
				stderr: "",
			}),
		);
		await expect(installPackages("pnpm", "/tmp/project", ["@emito/core"])).resolves.toBeUndefined();
	});

	it("still throws when pnpm add fails for a real reason", async () => {
		const { execa } = await import("execa");
		vi.mocked(execa).mockRejectedValueOnce(
			Object.assign(new Error("Command failed with exit code 1"), {
				exitCode: 1,
				stdout: "",
				stderr: "ERR_PNPM_NO_MATCHING_VERSION No matching version found for @emito/core@999.0.0",
			}),
		);
		await expect(installPackages("pnpm", "/tmp/project", ["@emito/core"])).rejects.toThrow();
	});

	it("does not swallow the ignored-builds exit code for non-pnpm managers", async () => {
		const { execa } = await import("execa");
		vi.mocked(execa).mockRejectedValueOnce(
			Object.assign(new Error("Command failed with exit code 1"), {
				exitCode: 1,
				stdout: "[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1",
				stderr: "",
			}),
		);
		await expect(installPackages("npm", "/tmp/project", ["@emito/core"])).rejects.toThrow();
	});
});
