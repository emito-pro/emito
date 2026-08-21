import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import type { EmitoServer } from "../handler.js";

/**
 * Creates a Fastify plugin that registers the Emito server handler.
 *
 * Uses Fastify's already-parsed request body — no content type parser
 * manipulation needed. The parsed body is re-serialized to JSON for the
 * Web Standard Request constructor.
 *
 * Usage:
 * ```ts
 * fastify.register(createFastifyPlugin(server));
 * ```
 */
export function createFastifyPlugin(server: EmitoServer): FastifyPluginCallback {
	const plugin: FastifyPluginCallback = (fastify, _opts, done) => {
		fastify.all(`${server.prefix}/*`, async (request: FastifyRequest, reply: FastifyReply) => {
			const protocol = request.protocol;
			const host = request.hostname;
			const url = `${protocol}://${host}${request.url}`;

			const headers = new Headers();
			for (const [key, value] of Object.entries(request.headers)) {
				if (value === undefined) continue;
				if (Array.isArray(value)) {
					for (const v of value) headers.append(key, v);
				} else {
					headers.set(key, value);
				}
			}

			const init: RequestInit = {
				method: request.method,
				headers,
			};

			// Re-serialize parsed body for the Web Standard Request constructor
			if (request.body !== undefined && request.body !== null) {
				init.body = JSON.stringify(request.body);
			}

			const webRequest = new Request(url, init);
			const response = await server.handler(webRequest);

			reply.status(response.status);
			for (const [key, value] of response.headers) {
				reply.header(key, value);
			}
			reply.send(await response.text());
		});

		// Auto-wire WebSocket upgrade handling
		const wsPathPrefix = `${server.apiBase}/ws`;
		fastify.server.on("upgrade", (req, socket, head) => {
			const url = req.url ?? "";
			if (!url.startsWith(wsPathPrefix)) return; // pass through non-Emito upgrades
			void server.handleUpgrade(req, socket, head);
		});

		done();
	};

	return plugin;
}
