import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Context } from "hono";
import type { EmitoServer } from "../handler.js";

/**
 * The slice of a Hono app this adapter touches. Structural on purpose — Hono's
 * `Hono<Env, Schema, BasePath>` generics would leak into every call site, and all
 * the adapter needs is wildcard route registration.
 */
export interface HonoLikeApp {
	all(path: string, handler: (c: Context) => Promise<Response>): unknown;
}

/**
 * Returns a Hono route handler for the Emito API.
 *
 * Hono is Web Standard native, so the request passes through untouched — no
 * Node stream bridging, and the same handler works on Node, Bun, Deno, and
 * Workers.
 *
 * Usage:
 * ```ts
 * app.all(`${server.prefix}/*`, toHonoHandler(server));
 * ```
 * Or let {@link mountHono} register that route for you.
 */
export function toHonoHandler(server: EmitoServer): (c: Context) => Promise<Response> {
	return async (c) => server.handler(await toWebRequest(c));
}

/**
 * Mounts the Emito API on a Hono app under `server.prefix`.
 *
 * The route pattern is absolute (`/emito/*`), not a sub-app mounted with
 * `app.route()`: Emito matches routes against the full `/emito/...` path, and
 * `app.route()` would strip the base path before the handler ever sees it.
 *
 * Usage:
 * ```ts
 * mountHono(app, server);
 * ```
 */
export function mountHono(app: HonoLikeApp, server: EmitoServer): void {
	app.all(`${server.prefix}/*`, toHonoHandler(server));
}

/**
 * Returns a WebSocket upgrade handler for a Hono app served by
 * `@hono/node-server`.
 *
 * WebSocket upgrades never reach a Hono handler — they are an HTTP-server level
 * event, so they have to be wired on the Node server that `serve()` returns.
 *
 * **Non-Node runtimes:** on Bun, Deno, and Cloudflare Workers the upgrade is
 * handled by the runtime's own WebSocket API, which this handler cannot drive.
 * Use the SSE or polling transport there.
 *
 * Usage:
 * ```ts
 * import { serve } from '@hono/node-server';
 *
 * const httpServer = serve({ fetch: app.fetch, port: 3000 });
 * httpServer.on('upgrade', createHonoWsHandler(emitoServer));
 * ```
 */
export function createHonoWsHandler(
	server: EmitoServer,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
	return (req, socket, head) => {
		void server.handleUpgrade(req, socket, head);
	};
}

/**
 * Hands `c.req.raw` straight to the handler unless upstream middleware already
 * read the body — a logging or validation middleware calling `c.req.json()`
 * consumes the underlying stream, and Emito would then see an unreadable
 * request (webhook signature checks in particular need the raw bytes). Hono
 * caches what it read, so `c.req.arrayBuffer()` can still replay it.
 */
async function toWebRequest(c: Context): Promise<Request> {
	const raw = c.req.raw;
	if (!raw.bodyUsed) return raw;

	return new Request(raw.url, {
		method: raw.method,
		headers: raw.headers,
		body: await c.req.arrayBuffer(),
	});
}
