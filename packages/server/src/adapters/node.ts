import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { EmitoServer } from "../handler.js";
import { readBody } from "./read-body.js";

export interface NodeHandlerOptions {
	bodyTimeout?: number;
	maxBodySize?: number;
}

/**
 * Returns an upgrade handler for WebSocket connections on a raw Node.js HTTP server.
 *
 * Usage:
 * ```ts
 * httpServer.on('upgrade', toNodeUpgradeHandler(emitServer));
 * ```
 */
export function toNodeUpgradeHandler(
	server: EmitoServer,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
	return (req, socket, head) => {
		void server.handleUpgrade(req, socket, head);
	};
}

export function toNodeHandler(
	server: EmitoServer,
	options?: NodeHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
	return (req, res) => {
		const protocol = (req.headers["x-forwarded-proto"] as string) ?? "http";
		const host = req.headers.host ?? "localhost";
		const url = `${protocol}://${host}${req.url ?? "/"}`;

		readBody(req, options)
			.then(async (body) => {
				const headers = new Headers();
				for (const [key, value] of Object.entries(req.headers)) {
					if (value === undefined) continue;
					if (Array.isArray(value)) {
						for (const v of value) headers.append(key, v);
					} else {
						headers.set(key, value);
					}
				}

				const init: RequestInit = {
					method: req.method ?? "GET",
					headers,
				};
				if (body.length > 0 && req.method !== "GET" && req.method !== "HEAD") {
					init.body = body;
				}

				const request = new Request(url, init);

				const response = await server.handler(request);
				res.writeHead(response.status, Object.fromEntries(response.headers));
				const responseBody = await response.text();
				res.end(responseBody);
			})
			.catch((err) => {
				if (err instanceof EmitoError) {
					res.writeHead(err.statusCode);
					res.end(
						JSON.stringify({
							error: {
								code: err.code,
								message: err.message,
								statusCode: err.statusCode,
							},
						}),
					);
					return;
				}
				res.writeHead(500);
				res.end(
					JSON.stringify({
						error: {
							code: EMITO_ERROR_CODE.INTERNAL_ERROR,
							message: String(err),
							statusCode: 500,
						},
					}),
				);
			});
	};
}
