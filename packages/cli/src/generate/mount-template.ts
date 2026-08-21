import type { BackendFramework } from "../detect/framework.js";
import type { GenerateOptions } from "./config-template.js";

const ADAPTER_IMPORTS: Record<BackendFramework, string> = {
	// Express intentionally uses the generic Node handler, not `@emito/server/express`'s
	// `emitRouter` — see the note in the express MOUNT_BODIES entry below.
	express: 'import { toNodeHandler, toNodeUpgradeHandler } from "@emito/server/node";',
	fastify: 'import { createFastifyPlugin } from "@emito/server/fastify";',
	hono: 'import { createHonoWsHandler, mountHono } from "@emito/server/hono";',
	nextjs: 'import { toNextJsHandler } from "@emito/server/nextjs";',
	node: 'import { toNodeHandler, toNodeUpgradeHandler } from "@emito/server/node";',
};

/**
 * Framework-specific type imports needed by `MOUNT_BODIES`. Kept separate so they
 * can be emitted with the rest of the imports at the top of the generated file —
 * appending them next to the function body would leave imports *after* declarations,
 * which trips `import/first`-style lint rules in consumer projects (and reads wrong,
 * even though TS hoists them).
 */
const MOUNT_TYPE_IMPORTS: Record<BackendFramework, string> = {
	express: 'import type { Express } from "express";',
	fastify: 'import type { FastifyInstance } from "fastify";',
	hono: 'import type { Hono } from "hono";',
	nextjs: "",
	node: "",
};

/**
 * The call to show in the generated file's header TODO. The `mountEmito` signature
 * genuinely differs per framework — nextjs/node take only the server — so a single
 * generic example would be wrong for half the frameworks, and it's the first thing
 * a skimming reader copies.
 */
const MOUNT_CALL_HINTS: Record<BackendFramework, string> = {
	express: "const { upgradeHandler } = mountEmito(app, server);",
	fastify: "mountEmito(app, server);",
	hono: "const { upgradeHandler } = mountEmito(app, server);",
	nextjs: "export const { GET, POST, PUT, PATCH, DELETE } = mountEmito(server);",
	node: "const { handler, upgradeHandler } = mountEmito(server);",
};

/** Exact `mountEmito` signature lines in `MOUNT_BODIES`, used to swap in the
 * JS-safe signature below via a literal substring replace. */
const MOUNT_SIGNATURES_TS: Record<BackendFramework, string> = {
	express: "export function mountEmito(app: Express, server: EmitoServer) {",
	fastify: "export function mountEmito(app: FastifyInstance, server: EmitoServer): void {",
	hono: "export function mountEmito(app: Hono, server: EmitoServer) {",
	nextjs: "export function mountEmito(server: EmitoServer) {",
	node: "export function mountEmito(server: EmitoServer) {",
};

const MOUNT_SIGNATURES_JS: Record<BackendFramework, string> = {
	express: "export function mountEmito(app, server) {",
	fastify: "export function mountEmito(app, server) {",
	hono: "export function mountEmito(app, server) {",
	nextjs: "export function mountEmito(server) {",
	node: "export function mountEmito(server) {",
};

const MOUNT_BODIES: Record<BackendFramework, string> = {
	express: `// Usage:
//   const { server, cleanup } = await buildEmitoServer();
//   const { upgradeHandler } = mountEmito(app, server);
//   const httpServer = app.listen(3000);
//   httpServer.on("upgrade", upgradeHandler);
//   process.on("SIGTERM", async () => {
//     await cleanup();
//     process.exit(0);
//   });
//
// NOTE: we deliberately do NOT mount \`@emito/server/express\`'s \`emitRouter\` result
// as sub-app middleware under the "/emito" path here.
// Express strips the mount path from \`req.url\`, but EmitoServer matches routes
// against the full "/emito/..." patterns, so every request would 404. Mounting
// \`toNodeHandler\` directly and restoring the original URL keeps the prefix intact.
export function mountEmito(app: Express, server: EmitoServer) {
	const handler = toNodeHandler(server);
	app.use("/emito", (req, res) => {
		req.url = req.originalUrl;
		handler(req, res);
	});
	// Express only sees HTTP requests — WebSocket upgrades are an event on the
	// underlying http.Server, wired the same way as the generic Node adapter.
	return { upgradeHandler: toNodeUpgradeHandler(server) };
}`,
	fastify: `// Usage:
//   const { server, cleanup } = await buildEmitoServer();
//   mountEmito(app, server);
//   app.addHook("onClose", cleanup);
export function mountEmito(app: FastifyInstance, server: EmitoServer): void {
	app.register(createFastifyPlugin(server));
}`,
	hono: `// Usage:
//   const { server, cleanup } = await buildEmitoServer();
//   const { upgradeHandler } = mountEmito(app, server);
//   // WebSocket upgrades are an HTTP-server event, so they bypass Hono's router
//   // entirely — wire them on the Node server \`@hono/node-server\` hands back:
//   const httpServer = serve({ fetch: app.fetch, port: 3000 });
//   httpServer.on("upgrade", upgradeHandler);
//   process.on("SIGTERM", async () => {
//     await cleanup();
//     process.exit(0);
//   });
//
// On Bun / Deno / Workers, drop the upgrade wiring — those runtimes own the
// WebSocket handshake, so use Emito's SSE or polling transport there instead.
export function mountEmito(app: Hono, server: EmitoServer) {
	mountHono(app, server);
	return { upgradeHandler: createHonoWsHandler(server) };
}`,
	nextjs: `// Usage in app/emito/[...route]/route.ts:
//   const { server } = await buildEmitoServer();
//   export const { GET, POST, PUT, PATCH, DELETE } = mountEmito(server);
// (a long-lived Next.js server has no single shutdown hook — call the \`cleanup\`
// returned by buildEmitoServer() from your own shutdown handler if you have one.)
export function mountEmito(server: EmitoServer) {
	return toNextJsHandler(server);
}`,
	node: `// Usage:
//   const { server, cleanup } = await buildEmitoServer();
//   const { handler, upgradeHandler } = mountEmito(server);
//   httpServer.on("request", handler);
//   httpServer.on("upgrade", upgradeHandler);
//   process.on("SIGTERM", async () => {
//     await cleanup();
//     process.exit(0);
//   });
export function mountEmito(server: EmitoServer) {
	return { handler: toNodeHandler(server), upgradeHandler: toNodeUpgradeHandler(server) };
}`,
};

export function renderMountTemplate(opts: GenerateOptions): string {
	const lang = opts.lang ?? "ts";
	const isTs = lang === "ts";
	const typeImport = isTs ? MOUNT_TYPE_IMPORTS[opts.framework] : "";
	const frameworkImports = [ADAPTER_IMPORTS[opts.framework], typeImport]
		.filter((line) => line !== "")
		.join("\n");

	const serverTypeImportLine = isTs ? 'import type { EmitoServer } from "@emito/server";\n' : "";

	const serverHandleInterfaceBlock = isTs
		? `export interface EmitoServerHandle {
	server: EmitoServer;
	/** The runtime handed to \`createEmitoServer\` — call \`emito.send(...)\` yourself, e.g. from a test route, to trigger a notification manually. */
	emito: Awaited<ReturnType<typeof createEmitoRuntime>>["emito"];
	/** Same repositories \`createEmitoServer\` uses — read subscribers/notifications directly if you need to. */
	repositories: Awaited<ReturnType<typeof createEmitoRuntime>>["repositories"];
	/** Stops Emito's workers and disconnects Redis + Postgres — call this on process shutdown. */
	cleanup: () => Promise<void>;
}

`
		: "";

	const buildReturnType = isTs ? ": Promise<EmitoServerHandle>" : "";

	const mountBody = isTs
		? MOUNT_BODIES[opts.framework]
		: MOUNT_BODIES[opts.framework].replace(
				MOUNT_SIGNATURES_TS[opts.framework],
				MOUNT_SIGNATURES_JS[opts.framework],
			);

	return `// Generated by \`emito init\` — you own this file, edit freely.
// TODO: mount this in your entrypoint:
//   import { buildEmitoServer, mountEmito } from "./emito.mount";
//   const { server, cleanup } = await buildEmitoServer();
//   ${MOUNT_CALL_HINTS[opts.framework]}
//   // and on shutdown: process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });
//   // (a SIGTERM listener disables Node's own default exit-on-SIGTERM — skip
//   // process.exit() here and a restart leaves a zombie process still bound
//   // to the port, serving requests against a database connection cleanup()
//   // just closed.)
import { createEmitoServer } from "@emito/server";
${serverTypeImportLine}import { createJwtAuth } from "@emito/auth-jwt";
${frameworkImports}
import { createEmitoRuntime } from "./emito.config.js";

${serverHandleInterfaceBlock}export async function buildEmitoServer()${buildReturnType} {
	const jwtSecret = process.env.EMITO_JWT_SECRET;
	const apiKey = process.env.EMITO_API_KEY;
	if (!jwtSecret || !apiKey) {
		throw new Error("EMITO_JWT_SECRET and EMITO_API_KEY must be set to start Emito");
	}

	const { emito, repositories, redis, cleanup } = await createEmitoRuntime();

	// Two permissive defaults below only warn once, at boot — not on every
	// request — because that's the only place generated code can tell "this
	// default was never touched" from "this default was deliberately kept".
	// Add cookieName here (and set that cookie server-side, alongside the
	// token you hand to EmitoProvider) if you use the WebSocket transport in
	// a browser — it can't attach an Authorization header to the handshake,
	// so it authenticates via cookie instead. See the docs' /gotchas page.
	// Until you do, WS auth fails closed with no further logging anywhere —
	// REST keeps working, so this is easy to miss.
	console.warn(
		"[emito] resolveSubscriberId has no cookieName — WebSocket auth (used by the live bell/toast) will silently never connect until you add one. See the docs' /gotchas page.",
	);
	// Secure by default: every authenticated subscriber is treated as a workspace
	// *member*, so Emito's admin API (cross-workspace reads, subscriber erase,
	// broadcasts, dead-letters) stays locked. To expose those endpoints, resolve
	// the real role from your own auth/DB and return "admin" only for actual
	// workspace admins.
	console.warn(
		"[emito] resolveWorkspaceRole defaults every subscriber to the 'member' role — Emito's admin API stays locked until you replace this with your own auth/DB check.",
	);

	const server = createEmitoServer({
		emito,
		apiKey,
		prefix: "/emito",
		repositories,
		redisClient: redis,
		resolveSubscriberId: createJwtAuth({ hmacSecret: jwtSecret }),
		resolveWorkspaceRole: async () => "member",
	});

	return { server, emito, repositories, cleanup };
}

${mountBody}
`;
}
