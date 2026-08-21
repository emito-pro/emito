import type { IncomingMessage } from "node:http";
import { URL } from "node:url";

/**
 * Construct a minimal Web Standard Request from a Node.js IncomingMessage.
 * Copies headers and URL — no body (suitable for upgrade / auth-only use).
 */
export function toWebRequest(req: IncomingMessage): Request {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value !== undefined) {
			if (Array.isArray(value)) {
				for (const v of value) {
					headers.append(key, v);
				}
			} else {
				headers.set(key, value);
			}
		}
	}
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
	return new Request(url.toString(), { headers });
}
