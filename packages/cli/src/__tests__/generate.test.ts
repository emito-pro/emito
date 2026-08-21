import { describe, expect, it } from "vitest";
import { renderConfigTemplate } from "../generate/config-template.js";
import { renderMountTemplate } from "../generate/mount-template.js";

describe("renderMountTemplate", () => {
	it("mounts express via toNodeHandler, not the prefix-stripping emitRouter", () => {
		const source = renderMountTemplate({ framework: "express", channels: ["email"] });
		expect(source).toContain(
			'import { toNodeHandler, toNodeUpgradeHandler } from "@emito/server/node"',
		);
		expect(source).not.toContain('import { emitRouter } from "@emito/server/express"');
		expect(source).toContain("export function mountEmito(app: Express, server: EmitoServer)");
		// Express strips the mount path from req.url — the template must restore it,
		// otherwise EmitoServer's "/emito/..." route patterns never match.
		expect(source).toContain("req.url = req.originalUrl");
	});

	it("wires WebSocket upgrade handling for express, matching the generic node adapter", () => {
		const source = renderMountTemplate({ framework: "express", channels: [] });
		expect(source).toContain("return { upgradeHandler: toNodeUpgradeHandler(server) };");
		expect(source).toContain("const { upgradeHandler } = mountEmito(app, server);");
	});

	it("uses an explicit process.exit(0) after cleanup in every SIGTERM snippet, for every framework", () => {
		// A SIGTERM listener disables Node's default exit-on-SIGTERM behavior;
		// without an explicit process.exit() the process survives past cleanup()
		// closing the DB/Redis connections, and becomes a zombie on the next
		// restart. Every generated SIGTERM snippet must call process.exit(0).
		for (const framework of ["express", "hono", "node"] as const) {
			const source = renderMountTemplate({ framework, channels: [] });
			expect(source).toMatch(/process\.on\("SIGTERM"[\s\S]*?process\.exit\(0\)/);
		}
	});

	it("defaults resolveWorkspaceRole to a non-privileged member role (admin API locked)", () => {
		const source = renderMountTemplate({ framework: "fastify", channels: [] });
		// Secure by default: the generated placeholder must NOT hand every
		// authenticated subscriber workspace-admin.
		expect(source).toContain('resolveWorkspaceRole: async () => "member"');
		expect(source).not.toContain('resolveWorkspaceRole: async () => "admin"');
		expect(source).toMatch(/Secure by default[\s\S]*resolveWorkspaceRole: async \(\) => "member"/);
	});

	it("returns a { server, emito, repositories, cleanup } handle from buildEmitoServer", () => {
		for (const framework of ["express", "fastify", "hono", "nextjs", "node"] as const) {
			const source = renderMountTemplate({ framework, channels: [] });
			expect(source).toContain("Promise<EmitoServerHandle>");
			expect(source).toContain("const { emito, repositories, redis, cleanup } =");
			expect(source).toContain("return { server, emito, repositories, cleanup };");
		}
	});

	it("imports createFastifyPlugin for fastify", () => {
		const source = renderMountTemplate({ framework: "fastify", channels: ["email"] });
		expect(source).toContain('import { createFastifyPlugin } from "@emito/server/fastify"');
	});

	it("mounts hono with an absolute prefix route plus a WS upgrade handler", () => {
		const source = renderMountTemplate({ framework: "hono", channels: ["email"] });
		expect(source).toContain('import { createHonoWsHandler, mountHono } from "@emito/server/hono"');
		expect(source).toContain("export function mountEmito(app: Hono, server: EmitoServer)");
		// Hono routes never see an upgrade request — it has to be wired on the Node
		// server @hono/node-server returns, so the mount must hand it back.
		expect(source).toContain("upgradeHandler: createHonoWsHandler(server)");
	});

	it("imports toNextJsHandler for nextjs", () => {
		const source = renderMountTemplate({ framework: "nextjs", channels: ["sms"] });
		expect(source).toContain('import { toNextJsHandler } from "@emito/server/nextjs"');
	});

	it("imports toNodeHandler for the generic node fallback", () => {
		const source = renderMountTemplate({ framework: "node", channels: [] });
		expect(source).toContain(
			'import { toNodeHandler, toNodeUpgradeHandler } from "@emito/server/node"',
		);
	});

	it("puts every import before the first declaration, for all frameworks", () => {
		// Framework type imports used to be appended with the mount body at the end of
		// the file — legal TS (hoisting) but it trips `import/first`-style lint rules in
		// consumer projects and reads as a mistake.
		for (const framework of ["express", "fastify", "hono", "nextjs", "node"] as const) {
			const lines = renderMountTemplate({ framework, channels: [] }).split("\n");
			const importIndexes = lines
				.map((line, index) => (line.startsWith("import ") ? index : -1))
				.filter((index) => index !== -1);
			const lastImport = importIndexes.at(-1) ?? -1;
			const firstDeclaration = lines.findIndex((line) => line.startsWith("export "));
			expect(lastImport).toBeGreaterThan(-1);
			expect(firstDeclaration).toBeGreaterThan(-1);
			expect(lastImport).toBeLessThan(firstDeclaration);
		}
	});

	it("shows a framework-correct mountEmito call in the header TODO", () => {
		// nextjs/node's real signature takes only the server — a generic
		// `mountEmito(app, server)` header would be wrong for both.
		const expressHeader = renderMountTemplate({ framework: "express", channels: [] }).split(
			"export interface",
		)[0] as string;
		expect(expressHeader).toContain("TODO: mount this in your entrypoint:");
		expect(expressHeader).toContain("const { upgradeHandler } = mountEmito(app, server);");

		expect(renderMountTemplate({ framework: "fastify", channels: [] })).toMatch(
			/TODO: mount this in your entrypoint:[\s\S]*\/\/ {3}mountEmito\(app, server\);/,
		);

		const honoHeader = renderMountTemplate({ framework: "hono", channels: [] }).split(
			"export interface",
		)[0] as string;
		expect(honoHeader).toContain("const { upgradeHandler } = mountEmito(app, server);");

		const nextjsHeader = renderMountTemplate({ framework: "nextjs", channels: [] }).split(
			"export interface",
		)[0] as string;
		expect(nextjsHeader).toContain("= mountEmito(server);");
		expect(nextjsHeader).not.toContain("mountEmito(app, server)");

		const nodeHeader = renderMountTemplate({ framework: "node", channels: [] }).split(
			"export interface",
		)[0] as string;
		expect(nodeHeader).toContain("const { handler, upgradeHandler } = mountEmito(server);");
		expect(nodeHeader).not.toContain("mountEmito(app, server)");
	});

	it("tells Next.js users to mount at a route matching the configured prefix", () => {
		// `buildEmitoServer` below hardcodes `prefix: "/emito"` — the usage comment
		// must point at app/emito/[...route], not app/api/emito/[...route]. A route
		// nested one level deeper than the prefix never matches (EmitoServer's router
		// sees the full request path, and `/api/emito/v1/...` != `/emito/v1/...`).
		const source = renderMountTemplate({ framework: "nextjs", channels: [] });
		expect(source).toContain("Usage in app/emito/[...route]/route.ts");
		expect(source).not.toContain("app/api/emito");
		expect(source).toContain('prefix: "/emito"');
	});
});

describe("renderConfigTemplate", () => {
	it("wires the resend provider when email is selected", () => {
		const source = renderConfigTemplate({ framework: "express", channels: ["email"] });
		expect(source).toContain('import("@emito/provider-resend")');
		expect(source).toContain("createResendProvider");
	});

	it("wires the smsapi provider when sms is selected", () => {
		const source = renderConfigTemplate({ framework: "express", channels: ["sms"] });
		expect(source).toContain('import("@emito/provider-smsapi")');
	});

	it("always includes inApp with a mock provider", () => {
		const source = renderConfigTemplate({ framework: "express", channels: [] });
		expect(source).toContain('createMockProvider("inApp"');
	});

	it("imports ProviderPlugin from @emito/core, never from the uninstalled @emito/types", () => {
		const source = renderConfigTemplate({ framework: "express", channels: ["email", "sms"] });
		expect(source).not.toContain("@emito/types");
		expect(source).toMatch(/import \{[^}]*type ProviderPlugin,[^}]*\} from "@emito\/core";/s);
	});

	it("omits the ProviderPlugin import when no extra channel is selected", () => {
		const source = renderConfigTemplate({ framework: "express", channels: [] });
		expect(source).not.toContain("ProviderPlugin");
	});

	it("indents the provider blocks to sit inside createEmitoRuntime's body", () => {
		// Only the first line of each block used to pick up the template literal's
		// leading tab; the rest landed flush-left inside the function.
		const source = renderConfigTemplate({ framework: "fastify", channels: ["email", "sms"] });
		const body = source
			.split("export async function createEmitoRuntime")[1]
			?.split("\n")
			.slice(1) as string[];
		const unindented = body.filter((line) => line !== "" && line !== "}" && !line.startsWith("\t"));
		expect(unindented).toEqual([]);
		expect(source).toContain("\tconst emailProviders: ProviderPlugin[] = [];");
		expect(source).toContain("\t\temailProviders.push(");
		expect(source).toContain("\tconst smsProviders: ProviderPlugin[] = [];");
	});

	it("declares provider arrays only for selected channels", () => {
		const emailOnly = renderConfigTemplate({ framework: "express", channels: ["email"] });
		expect(emailOnly).toContain("const emailProviders");
		expect(emailOnly).not.toContain("smsProviders");

		const none = renderConfigTemplate({ framework: "express", channels: [] });
		expect(none).not.toContain("emailProviders");
		expect(none).not.toContain("smsProviders");
	});
});

// A plain-JS consumer project (no tsconfig.json) has no TypeScript loader, so a
// generated file that still contains `import type`, `interface`, `satisfies`, or
// type annotations would fail with ERR_MODULE_NOT_FOUND / a syntax error the
// moment it's imported. These assert the JS output has none of it.
const TS_ONLY_PATTERNS = [
	/\bimport type\b/,
	/\binterface\s+\w+\s*\{/,
	/\bsatisfies\b/,
	/\bas unknown as\b/,
	/:\s*(Emito|EmitoServer|EmitoServerRepositories|EmitoServerHandle|EmitoRuntime|DrizzleDb|ProviderPlugin\[\]|Express|FastifyInstance|Hono)\b/,
	/\bPromise<\w+>/,
];

const CHANNEL_SETS: Array<Array<"email" | "sms">> = [[], ["email"], ["sms"], ["email", "sms"]];

describe("renderConfigTemplate (lang: js)", () => {
	it("contains no TypeScript-only syntax", () => {
		for (const channels of CHANNEL_SETS) {
			const source = renderConfigTemplate({ framework: "express", channels, lang: "js" });
			for (const pattern of TS_ONLY_PATTERNS) {
				expect(source).not.toMatch(pattern);
			}
		}
	});

	it("still imports every value it uses from @emito/core and @emito/db", () => {
		const source = renderConfigTemplate({ framework: "express", channels: ["email"], lang: "js" });
		expect(source).toContain("IoRedisAdapter, createEmito, createMockProvider");
		expect(source).toContain("DrizzleConsentRepository");
		expect(source).toContain("createDrizzleClient");
	});

	it("accesses db.$client.end() directly, with no type cast", () => {
		const source = renderConfigTemplate({ framework: "express", channels: [], lang: "js" });
		expect(source).toContain("await db.$client.end();");
	});

	it("defaults to ts when lang is omitted", () => {
		const withLang = renderConfigTemplate({ framework: "express", channels: [], lang: "ts" });
		const omitted = renderConfigTemplate({ framework: "express", channels: [] });
		expect(omitted).toBe(withLang);
	});
});

describe("renderMountTemplate (lang: js)", () => {
	it("contains no TypeScript-only syntax, for every framework", () => {
		for (const framework of ["express", "fastify", "hono", "nextjs", "node"] as const) {
			const source = renderMountTemplate({ framework, channels: [], lang: "js" });
			for (const pattern of TS_ONLY_PATTERNS) {
				expect(source).not.toMatch(pattern);
			}
		}
	});

	it("still emits a correctly-shaped mountEmito for each framework", () => {
		expect(renderMountTemplate({ framework: "express", channels: [], lang: "js" })).toContain(
			"export function mountEmito(app, server) {",
		);
		expect(renderMountTemplate({ framework: "hono", channels: [], lang: "js" })).toContain(
			"export function mountEmito(app, server) {",
		);
		expect(renderMountTemplate({ framework: "nextjs", channels: [], lang: "js" })).toContain(
			"export function mountEmito(server) {",
		);
	});

	it("defaults to ts when lang is omitted", () => {
		const withLang = renderMountTemplate({ framework: "fastify", channels: [], lang: "ts" });
		const omitted = renderMountTemplate({ framework: "fastify", channels: [] });
		expect(omitted).toBe(withLang);
	});
});
