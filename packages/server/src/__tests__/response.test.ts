import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { describe, expect, it } from "vitest";
import { collectionResponse, errorResponse, handleError, jsonResponse } from "../response.js";

async function parseJson(response: Response): Promise<unknown> {
	return JSON.parse(await response.text());
}

describe("jsonResponse", () => {
	it("wraps data in envelope", async () => {
		const res = jsonResponse({ id: "ntf_123", status: "sent" });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json");
		const body = await parseJson(res);
		expect(body).toEqual({ data: { id: "ntf_123", status: "sent" } });
	});

	it("uses custom status code", async () => {
		const res = jsonResponse({ id: "ntf_new" }, 201);
		expect(res.status).toBe(201);
	});
});

describe("collectionResponse", () => {
	it("returns items with hasMore and cursor", async () => {
		const res = collectionResponse([{ id: "ntf_1" }], true, "cursor123");
		const body = await parseJson(res);
		expect(body).toEqual({
			data: { items: [{ id: "ntf_1" }], hasMore: true, cursor: "cursor123" },
		});
	});

	it("omits cursor when hasMore is false", async () => {
		const res = collectionResponse([{ id: "ntf_1" }], false);
		const body = (await parseJson(res)) as { data: Record<string, unknown> };
		expect(body.data.hasMore).toBe(false);
		expect(body.data).not.toHaveProperty("cursor");
	});

	it("returns empty items array", async () => {
		const res = collectionResponse([], false);
		const body = (await parseJson(res)) as { data: { items: unknown[] } };
		expect(body.data.items).toEqual([]);
	});
});

describe("errorResponse", () => {
	it("formats error envelope", async () => {
		const res = errorResponse({
			code: "SUBSCRIBER_NOT_FOUND",
			message: "Not found",
			statusCode: 404,
		});
		expect(res.status).toBe(404);
		const body = await parseJson(res);
		expect(body).toEqual({
			error: { code: "SUBSCRIBER_NOT_FOUND", message: "Not found", statusCode: 404 },
		});
	});

	it("includes details when present", async () => {
		const res = errorResponse({
			code: "VALIDATION_ERROR",
			message: "Bad input",
			statusCode: 400,
			details: { field: "email" },
		});
		const body = (await parseJson(res)) as { error: Record<string, unknown> };
		expect(body.error.details).toEqual({ field: "email" });
	});

	it("omits details when undefined", async () => {
		const res = errorResponse({
			code: "VALIDATION_ERROR",
			message: "Bad input",
			statusCode: 400,
		});
		const body = (await parseJson(res)) as { error: Record<string, unknown> };
		expect(body.error).not.toHaveProperty("details");
	});
});

describe("handleError", () => {
	it("formats EmitoError correctly", async () => {
		const err = new EmitoError({
			code: EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND,
			message: "Subscriber not found",
		});
		const res = handleError(err, false);
		expect(res.status).toBe(404);
		const body = (await parseJson(res)) as { error: { code: string } };
		expect(body.error.code).toBe("SUBSCRIBER_NOT_FOUND");
	});

	it("includes EmitoError context when includeErrorContext is true", async () => {
		const err = new EmitoError({
			code: EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND,
			message: "Subscriber not found",
			context: { subscriberId: "sub_123" },
		});
		const res = handleError(err, true);
		const body = (await parseJson(res)) as { error: { details: unknown } };
		expect(body.error.details).toEqual({ subscriberId: "sub_123" });
	});

	it("formats unknown error as 500", async () => {
		const res = handleError(new Error("boom"), false);
		expect(res.status).toBe(500);
		const body = (await parseJson(res)) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("INTERNAL_ERROR");
		expect(body.error.message).toBe("Internal server error");
	});

	it("includes error message for unknown errors in dev mode", async () => {
		const res = handleError(new Error("secret boom"), true);
		const body = (await parseJson(res)) as { error: { message: string } };
		expect(body.error.message).toBe("secret boom");
	});

	it("formats ZodError as 400 with field details", async () => {
		const zodLikeError = {
			name: "ZodError",
			errors: [
				{ path: ["body", "email"], message: "Required" },
				{ path: ["body", "name"], message: "Too short" },
			],
		};
		const res = handleError(zodLikeError, false);
		expect(res.status).toBe(400);
		const body = (await parseJson(res)) as { error: { code: string; details: unknown[] } };
		expect(body.error.code).toBe("VALIDATION_ERROR");
		expect(body.error.details).toEqual([
			{ path: "body.email", message: "Required" },
			{ path: "body.name", message: "Too short" },
		]);
	});
});
