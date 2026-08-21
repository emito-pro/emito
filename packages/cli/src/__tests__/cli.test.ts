import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram, parseChannelsOption, parseFrameworkOption } from "../cli.js";
import type { InitResult } from "../commands/init.js";
import { runInit } from "../commands/init.js";

vi.mock("../commands/init.js", () => ({ runInit: vi.fn() }));

// Read the manifest independently of the CLI's own lookup, so this asserts the two
// really agree rather than restating whatever the CLI computed.
const packageJson = JSON.parse(
	readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string };

/**
 * Runs the `init` command and returns everything it put on screen. `@clack/prompts`
 * writes straight to `process.stdout`, so console spying alone would miss the
 * framed output (intro/outro/note/cancel).
 */
async function runInitCommand(argv: string[] = []): Promise<string> {
	const chunks: string[] = [];
	const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		chunks.push(String(chunk));
		return true;
	});
	const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		chunks.push(args.map(String).join(" "));
	});
	const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		chunks.push(args.map(String).join(" "));
	});
	try {
		await createProgram().parseAsync(["node", "emito", "init", ...argv]);
	} finally {
		stdoutSpy.mockRestore();
		logSpy.mockRestore();
		errorSpy.mockRestore();
	}
	return chunks.join("\n");
}

describe("createProgram", () => {
	afterEach(() => {
		vi.clearAllMocks();
		process.exitCode = 0;
	});

	it("reports the version from package.json", () => {
		const program = createProgram();
		expect(program.version()).toBe(packageJson.version);
		expect(program.version()).not.toBe("0.0.0");
	});

	it("is named emito", () => {
		const program = createProgram();
		expect(program.name()).toBe("emito");
	});

	it("prints the JWT secret as part of the final summary, after the generated files", async () => {
		vi.mocked(runInit).mockResolvedValue({
			status: "manual-mount-required",
			framework: "fastify",
			frontend: "none",
			generatedFiles: ["/tmp/app/emito.config.ts", "/tmp/app/emito.mount.ts"],
			jwtSecret: "s3cr3t-jwt-value",
		});

		const output = await runInitCommand();

		expect(output).toContain("EMITO_JWT_SECRET=s3cr3t-jwt-value");
		expect(output).toContain("do NOT commit it");
		// It has to come *after* the generated-files line — the whole point is that it
		// is the last thing left on screen when the run ends.
		expect(output.indexOf("s3cr3t-jwt-value")).toBeGreaterThan(output.indexOf("Generated:"));
	});

	it("names the failing prerequisite service and its error when aborting", async () => {
		vi.mocked(runInit).mockResolvedValue({
			status: "aborted-prerequisites",
			framework: null,
			generatedFiles: [],
			prerequisiteFailures: [
				"DATABASE_URL (PostgreSQL) is unreachable: ECONNREFUSED 127.0.0.1:5432",
				"REDIS_URL (Redis) is not set.",
			],
		});

		const output = await runInitCommand();

		expect(output).toContain(
			"DATABASE_URL (PostgreSQL) is unreachable: ECONNREFUSED 127.0.0.1:5432",
		);
		expect(output).toContain("REDIS_URL (Redis) is not set.");
		expect(process.exitCode).toBe(1);
	});
});

describe("emito init flags", () => {
	const successResult: InitResult = {
		status: "manual-mount-required",
		framework: "fastify",
		frontend: "none",
		generatedFiles: ["/tmp/app/emito.config.ts"],
		jwtSecret: "s3cr3t",
	};

	afterEach(() => {
		vi.clearAllMocks();
		process.exitCode = 0;
	});

	it("documents every flag in --help", () => {
		const help = createProgram()
			.commands.find((command) => command.name() === "init")
			?.helpInformation();
		expect(help).toContain("-y, --yes");
		expect(help).toContain("--channels <list>");
		expect(help).toContain("--framework <name>");
	});

	it("--yes injects a non-interactive wizard so nothing prompts", async () => {
		vi.mocked(runInit).mockResolvedValue({ ...successResult });

		await runInitCommand(["--yes"]);

		const options = vi.mocked(runInit).mock.calls[0]?.[0];
		expect(options?.wizard).toBeDefined();
		// It must be a real `Wizard`, resolving with defaults rather than prompting.
		await expect(options?.wizard?.selectChannels()).resolves.toEqual([]);
		await expect(options?.wizard?.confirmPlan("anything")).resolves.toBe(true);
		await expect(options?.wizard?.selectFramework("node")).resolves.toBe("node");
	});

	it("leaves the wizard unset (interactive) without --yes", async () => {
		vi.mocked(runInit).mockResolvedValue({ ...successResult });

		await runInitCommand([]);

		expect(vi.mocked(runInit).mock.calls[0]?.[0]?.wizard).toBeUndefined();
	});

	it("--channels email,sms passes both channels through to runInit", async () => {
		vi.mocked(runInit).mockResolvedValue({ ...successResult });

		await runInitCommand(["--channels", "email,sms"]);

		expect(vi.mocked(runInit).mock.calls[0]?.[0]?.channels).toEqual(["email", "sms"]);
	});

	it("--framework fastify bypasses detection", async () => {
		vi.mocked(runInit).mockResolvedValue({ ...successResult });

		await runInitCommand(["--framework", "fastify"]);

		expect(vi.mocked(runInit).mock.calls[0]?.[0]?.framework).toBe("fastify");
	});

	it("rejects unknown channels and frameworks instead of silently ignoring them", () => {
		expect(() => parseChannelsOption("email,carrier-pigeon")).toThrow(/Unknown channel/);
		expect(() => parseFrameworkOption("koa")).toThrow(/Unknown framework/);
		expect(parseChannelsOption("email, sms")).toEqual(["email", "sms"]);
		expect(parseChannelsOption("")).toEqual([]);
		expect(parseFrameworkOption("nextjs")).toBe("nextjs");
	});
});
