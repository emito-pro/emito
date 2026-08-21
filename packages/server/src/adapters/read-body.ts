import type { IncomingMessage } from "node:http";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";

export interface ReadBodyOptions {
	bodyTimeout?: number;
	maxBodySize?: number;
}

const DEFAULT_BODY_TIMEOUT = 15_000;
const DEFAULT_MAX_BODY_SIZE = 1_048_576;

export function readBody(req: IncomingMessage, options?: ReadBodyOptions): Promise<Buffer> {
	const timeout = options?.bodyTimeout ?? DEFAULT_BODY_TIMEOUT;
	const maxSize = options?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

	return new Promise<Buffer>((resolve, reject) => {
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		let settled = false;

		let timer: ReturnType<typeof setTimeout> | null = null;

		function settle() {
			settled = true;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
		}

		function resetTimer() {
			if (timer !== null) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				if (settled) return;
				settle();
				req.destroy();
				reject(
					new EmitoError({
						code: EMITO_ERROR_CODE.REQUEST_TIMEOUT,
						message: "Request body timeout",
						statusCode: 408,
					}),
				);
			}, timeout);
		}

		req.on("data", (chunk: Buffer) => {
			if (settled) return;
			totalBytes += chunk.length;
			if (totalBytes > maxSize) {
				settle();
				req.destroy();
				reject(
					new EmitoError({
						code: EMITO_ERROR_CODE.PAYLOAD_TOO_LARGE,
						message: "Request body too large",
						statusCode: 413,
					}),
				);
				return;
			}
			chunks.push(chunk);
			resetTimer();
		});

		req.on("end", () => {
			if (settled) return;
			settle();
			resolve(Buffer.concat(chunks));
		});

		req.on("error", () => {
			if (settled) return;
			settle();
			reject(
				new EmitoError({
					code: EMITO_ERROR_CODE.VALIDATION_ERROR,
					message: "Request read error",
					statusCode: 400,
				}),
			);
		});

		// Start initial idle timer
		resetTimer();
	});
}
