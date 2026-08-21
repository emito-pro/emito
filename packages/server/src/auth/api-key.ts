import { timingSafeEqual } from "node:crypto";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";

export function validateApiKey(provided: string, expected: string): void {
	const providedBuf = Buffer.from(provided, "utf-8");
	const expectedBuf = Buffer.from(expected, "utf-8");

	if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INVALID_API_KEY,
			message: "Invalid API key",
		});
	}
}
