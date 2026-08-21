import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ZodError } from "zod";

export function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify({ data }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export function collectionResponse(items: unknown[], hasMore: boolean, cursor?: string): Response {
	const data: Record<string, unknown> = { items, hasMore };
	if (hasMore && cursor !== undefined) {
		data.cursor = cursor;
	}
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

export interface ErrorResponseOptions {
	code: string;
	message: string;
	statusCode: number;
	details?: unknown;
}

/**
 * Sanitize a string for safe inclusion in API error responses.
 * Strips control characters (except space) and truncates to prevent
 * log injection, response bloat, and control character smuggling.
 */
function sanitizeMessage(message: string, maxLength = 500): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars
	return message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, maxLength);
}

export function errorResponse(opts: ErrorResponseOptions): Response {
	const error: Record<string, unknown> = {
		code: opts.code,
		message: sanitizeMessage(opts.message),
		statusCode: opts.statusCode,
	};
	if (opts.details !== undefined) {
		error.details = opts.details;
	}
	return new Response(JSON.stringify({ error }), {
		status: opts.statusCode,
		headers: { "Content-Type": "application/json" },
	});
}

export function handleError(err: unknown, includeErrorContext: boolean): Response {
	if (err instanceof EmitoError) {
		const hasContext = Object.keys(err.context).length > 0;
		return errorResponse({
			code: err.code,
			message: err.message,
			statusCode: err.statusCode,
			details: includeErrorContext && hasContext ? err.context : undefined,
		});
	}

	if (isZodError(err)) {
		const details = err.errors.map((e) => ({
			path: e.path.join("."),
			message: e.message,
		}));
		return errorResponse({
			code: EMITO_ERROR_CODE.VALIDATION_ERROR,
			message: "Request validation failed",
			statusCode: 400,
			details,
		});
	}

	// Unknown error
	const message =
		includeErrorContext && err instanceof Error ? err.message : "Internal server error";
	return errorResponse({
		code: EMITO_ERROR_CODE.INTERNAL_ERROR,
		message,
		statusCode: 500,
	});
}

function isZodError(err: unknown): err is ZodError {
	return (
		err !== null &&
		typeof err === "object" &&
		"errors" in err &&
		"name" in err &&
		(err as { name: string }).name === "ZodError"
	);
}
