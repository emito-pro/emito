import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { EmitoServer } from "../handler.js";

type NextHandler = (request: Request) => Promise<Response>;

export interface NextJsHandlers {
	GET: NextHandler;
	POST: NextHandler;
	PUT: NextHandler;
	PATCH: NextHandler;
	DELETE: NextHandler;
}

export function toNextJsHandler(server: EmitoServer): NextJsHandlers {
	const handle: NextHandler = (request) => server.handler(request);
	return {
		GET: handle,
		POST: handle,
		PUT: handle,
		PATCH: handle,
		DELETE: handle,
	};
}

/**
 * Returns a WebSocket upgrade handler for Next.js custom server setup.
 *
 * Next.js App Router does not support WebSocket natively. A custom `server.js`
 * with `http.createServer` is required to handle WS upgrades.
 *
 * **Vercel limitation:** Vercel's serverless/edge runtime does not support
 * WebSocket connections. Use SSE or polling transport on Vercel. WS is only
 * available with a custom Node.js server (self-hosted or traditional PaaS).
 *
 * Usage (server.js):
 * ```js
 * const { createServer } = require('http');
 * const next = require('next');
 * const { createNextWsHandler } = require('@emito/server/nextjs');
 *
 * const app = next({ dev: process.env.NODE_ENV !== 'production' });
 * const handle = app.getRequestHandler();
 * app.prepare().then(() => {
 *   const server = createServer(handle);
 *   server.on('upgrade', createNextWsHandler(emitServer));
 *   server.listen(3000);
 * });
 * ```
 */
export function createNextWsHandler(
	server: EmitoServer,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
	return (req, socket, head) => {
		void server.handleUpgrade(req, socket, head);
	};
}
