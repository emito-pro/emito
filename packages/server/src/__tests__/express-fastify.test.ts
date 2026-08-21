/**
 * Tests for Express and Fastify adapter wrappers.
 *
 * Rules applied:
 * - Follow describe/it naming (rule 15)
 * - Assert on shape of return values (rule 26)
 * - Assert on call arguments for mock verifications (rule 28)
 * - Never mock the module under test (rule 10)
 */

import { describe, expect, it, vi } from "vitest";
import { emitRouter } from "../adapters/express.js";
import { createFastifyPlugin } from "../adapters/fastify.js";
import type { EmitoServer } from "../handler.js";

function createMockServer(prefix = "/emito"): EmitoServer {
	return {
		handler: vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: { ok: true } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		),
		addRoute: vi.fn(),
		router: { add: vi.fn(), match: vi.fn(), routes: [] },
		prefix,
		handleUpgrade: vi.fn().mockResolvedValue(undefined),
	} as unknown as EmitoServer;
}

function createMockExpress() {
	const router = { all: vi.fn().mockReturnThis() };
	return { Router: vi.fn().mockReturnValue(router), _router: router };
}

// Minimal mock matching FastifyInstance shape after B-007 refactor:
// no addContentTypeParser — plugin must not require it.
function createMockFastify() {
	return {
		all: vi.fn(),
		server: { on: vi.fn() },
		// NOTE: addContentTypeParser intentionally absent — the refactored adapter
		// must not call it. If it does, the test will throw "not a function".
	};
}

describe("emitRouter", () => {
	it("should return a router object", () => {
		const server = createMockServer();
		const express = createMockExpress();
		expect(emitRouter(server, express)).toBeDefined();
	});

	it("should call express.Router() to create a new router", () => {
		const server = createMockServer();
		const express = createMockExpress();
		emitRouter(server, express);
		expect(express.Router).toHaveBeenCalledOnce();
	});

	it("should register a wildcard catch-all route", () => {
		const server = createMockServer();
		const express = createMockExpress();
		emitRouter(server, express);
		expect(express._router.all).toHaveBeenCalledWith("*", expect.any(Function));
	});

	it("should delegate requests to toNodeHandler via the catch-all", async () => {
		const server = createMockServer();
		const express = createMockExpress();
		emitRouter(server, express);

		const [, catchAllHandler] = express._router.all.mock.calls[0] as [
			string,
			(...args: unknown[]) => unknown,
		];

		const { IncomingMessage, ServerResponse } = await import("node:http");
		const { Socket } = await import("node:net");
		const socket = new Socket();
		const mockReq = new IncomingMessage(socket);
		mockReq.method = "GET";
		mockReq.url = "/emito/health";
		mockReq.headers = { host: "localhost" };

		const mockRes = new ServerResponse(mockReq);
		const ended = new Promise<void>((resolve) => {
			const origEnd = mockRes.end.bind(mockRes);
			mockRes.end = ((...args: unknown[]) => {
				origEnd(...(args as Parameters<typeof origEnd>));
				resolve();
			}) as typeof mockRes.end;
		});

		catchAllHandler(mockReq, mockRes);
		mockReq.emit("end");
		await ended;

		expect(server.handler).toHaveBeenCalledOnce();
	});
});

describe("createFastifyPlugin", () => {
	it("should return a function when called with a server", () => {
		const server = createMockServer();
		expect(typeof createFastifyPlugin(server)).toBe("function");
	});

	it("should register a wildcard route on the fastify instance", () => {
		const server = createMockServer();
		const plugin = createFastifyPlugin(server);
		const mockFastify = createMockFastify();
		const done = vi.fn();
		plugin(mockFastify as never, {}, done);
		expect(mockFastify.all).toHaveBeenCalledWith(
			expect.stringContaining("*"),
			expect.any(Function),
		);
	});

	it("should include the server prefix in the registered route path", () => {
		const server = createMockServer("/api/notifications");
		const plugin = createFastifyPlugin(server);
		const mockFastify = createMockFastify();
		const done = vi.fn();
		plugin(mockFastify as never, {}, done);
		const [registeredPath] = mockFastify.all.mock.calls[0] as [string, unknown];
		expect(registeredPath).toContain("/api/notifications");
	});

	it("should call done() after registering routes", () => {
		const server = createMockServer();
		const plugin = createFastifyPlugin(server);
		const mockFastify = createMockFastify();
		const done = vi.fn();
		plugin(mockFastify as never, {}, done);
		expect(done).toHaveBeenCalledOnce();
	});

	it("should NOT register a global content type parser (no addContentTypeParser hack)", () => {
		// B-007: The old emitPlugin called addContentTypeParser to suppress Fastify's
		// JSON parser so the raw body stream could be read manually. After the refactor,
		// the adapter uses request.body (already-parsed by Fastify) and must not touch
		// the content type parser at all.
		const server = createMockServer();
		const plugin = createFastifyPlugin(server);

		const addContentTypeParser = vi.fn();
		const mockFastify = {
			all: vi.fn(),
			server: { on: vi.fn() },
			addContentTypeParser,
		};

		const done = vi.fn();
		plugin(mockFastify as never, {}, done);

		expect(addContentTypeParser).not.toHaveBeenCalled();
	});

	it("should pass parsed body as JSON-serialized string to the Web Standard Request", async () => {
		// B-007: The refactored adapter receives an already-parsed body object from
		// Fastify (request.body) and re-serializes it to JSON to construct the Web
		// Standard Request — so server.handler receives a Request with a readable body.
		const server = createMockServer();
		const plugin = createFastifyPlugin(server);
		const mockFastify = createMockFastify();
		const done = vi.fn();
		plugin(mockFastify as never, {}, done);

		const [, routeHandler] = mockFastify.all.mock.calls[0] as [
			string,
			(...args: unknown[]) => unknown,
		];

		const parsedBody = { channel: "email", subscriberId: "sub_1" };

		// Simulate a Fastify request object with an already-parsed body
		const mockRequest = {
			method: "POST",
			url: "/emito/v1/notify",
			headers: { host: "localhost", "content-type": "application/json" },
			body: parsedBody,
		};

		const mockReply = {
			status: vi.fn().mockReturnThis(),
			header: vi.fn().mockReturnThis(),
			send: vi.fn().mockResolvedValue(undefined),
		};

		// Call the route handler — it should invoke server.handler
		await routeHandler(mockRequest, mockReply);

		expect(server.handler).toHaveBeenCalledOnce();

		const passedRequest = (server.handler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Request;
		expect(passedRequest.method).toBe("POST");

		// Verify the body was serialized back to JSON and is readable
		const bodyText = await passedRequest.text();
		expect(JSON.parse(bodyText)).toEqual(parsedBody);
	});

	it("should forward Fastify request headers to the Web Standard Request", async () => {
		const server = createMockServer();
		const plugin = createFastifyPlugin(server);
		const mockFastify = createMockFastify();
		const done = vi.fn();
		plugin(mockFastify as never, {}, done);

		const [, routeHandler] = mockFastify.all.mock.calls[0] as [
			string,
			(...args: unknown[]) => unknown,
		];

		const mockRequest = {
			method: "GET",
			url: "/emito/health",
			headers: {
				host: "localhost",
				authorization: "Bearer test-token",
				"x-emito-workspace-id": "ws_1",
			},
			body: null,
		};

		const mockReply = {
			status: vi.fn().mockReturnThis(),
			header: vi.fn().mockReturnThis(),
			send: vi.fn().mockResolvedValue(undefined),
		};

		await routeHandler(mockRequest, mockReply);

		const passedRequest = (server.handler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Request;
		expect(passedRequest.headers.get("authorization")).toBe("Bearer test-token");
		expect(passedRequest.headers.get("x-emito-workspace-id")).toBe("ws_1");
	});

	it("should handle null/missing body for GET requests without serializing body", async () => {
		const server = createMockServer();
		const plugin = createFastifyPlugin(server);
		const mockFastify = createMockFastify();
		const done = vi.fn();
		plugin(mockFastify as never, {}, done);

		const [, routeHandler] = mockFastify.all.mock.calls[0] as [
			string,
			(...args: unknown[]) => unknown,
		];

		const mockRequest = {
			method: "GET",
			url: "/emito/health",
			headers: { host: "localhost" },
			body: null,
		};

		const mockReply = {
			status: vi.fn().mockReturnThis(),
			header: vi.fn().mockReturnThis(),
			send: vi.fn().mockResolvedValue(undefined),
		};

		await routeHandler(mockRequest, mockReply);

		const passedRequest = (server.handler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Request;
		expect(passedRequest.method).toBe("GET");
	});
});
