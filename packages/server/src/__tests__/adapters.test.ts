import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { EmitoError } from "@emito/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toNextJsHandler } from "../adapters/nextjs.js";
import { toNodeHandler } from "../adapters/node.js";
import { readBody } from "../adapters/read-body.js";
import type { EmitoServer } from "../handler.js";

function createMockServer(responseBody = '{"data":{"ok":true}}', status = 200): EmitoServer {
	return {
		handler: vi.fn().mockResolvedValue(
			new Response(responseBody, {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		),
		addRoute: vi.fn(),
		router: { add: vi.fn(), match: vi.fn(), routes: [] },
		prefix: "/emito",
	} as unknown as EmitoServer;
}

describe("toNodeHandler", () => {
	it("bridges a GET request and returns response", async () => {
		const server = createMockServer();
		const nodeHandler = toNodeHandler(server);

		const { res, body } = await simulateNodeRequest(nodeHandler, {
			method: "GET",
			url: "/emito/health",
			headers: { host: "localhost:3000" },
		});

		expect(res.statusCode).toBe(200);
		expect(JSON.parse(body)).toEqual({ data: { ok: true } });
		expect(server.handler).toHaveBeenCalledOnce();
	});

	it("passes request body for POST", async () => {
		const server = createMockServer('{"data":{"id":"ntf_1"}}', 201);
		const nodeHandler = toNodeHandler(server);

		await simulateNodeRequest(nodeHandler, {
			method: "POST",
			url: "/emito/v1/notifications",
			headers: {
				host: "localhost:3000",
				"content-type": "application/json",
			},
			body: '{"event":"test"}',
		});

		expect(server.handler).toHaveBeenCalledOnce();
		const req = (server.handler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Request;
		expect(req.method).toBe("POST");
	});

	it("forwards request headers", async () => {
		const server = createMockServer();
		const nodeHandler = toNodeHandler(server);

		await simulateNodeRequest(nodeHandler, {
			method: "GET",
			url: "/emito/health",
			headers: {
				host: "localhost:3000",
				authorization: "Bearer test-token",
				"x-emito-admin-key": "my-key",
			},
		});

		const req = (server.handler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Request;
		expect(req.headers.get("authorization")).toBe("Bearer test-token");
		expect(req.headers.get("x-emito-admin-key")).toBe("my-key");
	});
});

describe("toNextJsHandler", () => {
	it("returns GET, POST, PUT, PATCH, DELETE handlers", () => {
		const server = createMockServer();
		const handlers = toNextJsHandler(server);
		expect(handlers).toHaveProperty("GET");
		expect(handlers).toHaveProperty("POST");
		expect(handlers).toHaveProperty("PUT");
		expect(handlers).toHaveProperty("PATCH");
		expect(handlers).toHaveProperty("DELETE");
	});

	it("delegates GET to server.handler", async () => {
		const server = createMockServer();
		const handlers = toNextJsHandler(server);
		const request = new Request("http://localhost/emito/health");
		const response = await handlers.GET(request);
		expect(response.status).toBe(200);
		expect(server.handler).toHaveBeenCalledWith(request);
	});

	it("delegates POST to server.handler", async () => {
		const server = createMockServer('{"data":{"id":"ntf_1"}}', 201);
		const handlers = toNextJsHandler(server);
		const request = new Request("http://localhost/emito/v1/notifications", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: '{"event":"test"}',
		});
		const response = await handlers.POST(request);
		expect(response.status).toBe(201);
		expect(server.handler).toHaveBeenCalledWith(request);
	});
});

describe("readBody", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves with the request body buffer", async () => {
		const req = createMockIncomingMessage();
		const promise = readBody(req, { bodyTimeout: 1000 });
		req.emit("data", Buffer.from("hello"));
		req.emit("end");
		const result = await promise;
		expect(result.toString()).toBe("hello");
	});

	it("resolves with empty buffer when no data is sent", async () => {
		const req = createMockIncomingMessage();
		const promise = readBody(req, { bodyTimeout: 1000 });
		req.emit("end");
		const result = await promise;
		expect(result.length).toBe(0);
	});

	it("rejects with REQUEST_TIMEOUT (408) on idle timeout", async () => {
		vi.useFakeTimers();
		const req = createMockIncomingMessage();
		const promise = readBody(req, { bodyTimeout: 100 });
		// Attach catch before advancing timers to prevent unhandled rejection
		const settled = promise.catch((e: unknown) => e);

		await vi.advanceTimersByTimeAsync(100);

		const err = await settled;
		expect(err).toBeInstanceOf(EmitoError);
		expect(err).toMatchObject({
			code: "REQUEST_TIMEOUT",
			statusCode: 408,
			isRetryable: true,
		});
	});

	it("rejects with PAYLOAD_TOO_LARGE (413) when body exceeds max size", async () => {
		const req = createMockIncomingMessage();
		const promise = readBody(req, { maxBodySize: 10, bodyTimeout: 1000 });
		req.emit("data", Buffer.alloc(20));

		const err = await promise.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(EmitoError);
		expect(err).toMatchObject({
			code: "PAYLOAD_TOO_LARGE",
			statusCode: 413,
			isRetryable: false,
		});
	});

	it("succeeds for slow-but-active connections within idle timeout", async () => {
		const req = createMockIncomingMessage();
		const promise = readBody(req, { bodyTimeout: 50, maxBodySize: 1_048_576 });

		// Send chunks with delays shorter than the idle timeout
		for (let i = 0; i < 3; i++) {
			await new Promise((r) => setTimeout(r, 10));
			req.emit("data", Buffer.from(`chunk${i}`));
		}
		req.emit("end");

		const result = await promise;
		expect(result.toString()).toBe("chunk0chunk1chunk2");
	});
});

describe("toNodeHandler — timeout and size limits", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns 408 when request body stalls", async () => {
		vi.useFakeTimers();
		const server = createMockServer();
		const nodeHandler = toNodeHandler(server, { bodyTimeout: 100 });

		const socket = new Socket();
		const req = new IncomingMessage(socket);
		req.method = "POST";
		req.url = "/emito/v1/test";
		req.headers = { host: "localhost:3000" };

		const { promise, res } = createCapturedResponse(req);

		nodeHandler(req, res);
		// Do not emit any data — simulate stalled client
		await vi.advanceTimersByTimeAsync(100);

		const { res: finishedRes, body } = await promise;
		expect(finishedRes.statusCode).toBe(408);
		const parsed = JSON.parse(body);
		expect(parsed.error.code).toBe("REQUEST_TIMEOUT");
		expect(parsed.error.statusCode).toBe(408);
	});

	it("returns 413 when request body exceeds max size", async () => {
		const server = createMockServer();
		const nodeHandler = toNodeHandler(server, { maxBodySize: 10, bodyTimeout: 5000 });

		const { res, body } = await simulateNodeRequest(nodeHandler, {
			method: "POST",
			url: "/emito/v1/test",
			headers: { host: "localhost:3000" },
			body: "x".repeat(20),
		});

		expect(res.statusCode).toBe(413);
		const parsed = JSON.parse(body);
		expect(parsed.error.code).toBe("PAYLOAD_TOO_LARGE");
		expect(parsed.error.statusCode).toBe(413);
	});

	it("GET request with no body succeeds unchanged when no options provided", async () => {
		const server = createMockServer('{"data":{"ok":true}}', 200);
		const nodeHandler = toNodeHandler(server);

		const { res, body } = await simulateNodeRequest(nodeHandler, {
			method: "GET",
			url: "/emito/health",
			headers: { host: "localhost:3000" },
		});

		expect(res.statusCode).toBe(200);
		expect(JSON.parse(body)).toEqual({ data: { ok: true } });
		expect(server.handler).toHaveBeenCalledOnce();
	});

	it("HEAD request with no body succeeds unchanged", async () => {
		const server = createMockServer("", 200);
		const nodeHandler = toNodeHandler(server);

		const { res } = await simulateNodeRequest(nodeHandler, {
			method: "HEAD",
			url: "/emito/health",
			headers: { host: "localhost:3000" },
		});

		expect(res.statusCode).toBe(200);
		expect(server.handler).toHaveBeenCalledOnce();
	});

	it("configurable bodyTimeout overrides default", async () => {
		vi.useFakeTimers();
		const server = createMockServer();
		const nodeHandler = toNodeHandler(server, { bodyTimeout: 50 });

		const socket = new Socket();
		const req = new IncomingMessage(socket);
		req.method = "POST";
		req.url = "/emito/v1/test";
		req.headers = { host: "localhost:3000" };

		const { promise, res } = createCapturedResponse(req);

		nodeHandler(req, res);
		await vi.advanceTimersByTimeAsync(50);

		const { res: finishedRes } = await promise;
		expect(finishedRes.statusCode).toBe(408);
	});

	it("configurable maxBodySize overrides default", async () => {
		const server = createMockServer();
		const nodeHandler = toNodeHandler(server, { maxBodySize: 5, bodyTimeout: 5000 });

		const { res } = await simulateNodeRequest(nodeHandler, {
			method: "POST",
			url: "/emito/v1/test",
			headers: { host: "localhost:3000" },
			body: "x".repeat(10),
		});

		expect(res.statusCode).toBe(413);
	});
});

function createMockIncomingMessage(): IncomingMessage {
	const socket = new Socket();
	return new IncomingMessage(socket);
}

function createCapturedResponse(req: IncomingMessage): {
	promise: Promise<{ res: ServerResponse; body: string }>;
	res: ServerResponse;
} {
	const res = new ServerResponse(req);
	const chunks: Buffer[] = [];
	const origWrite = res.write.bind(res);
	const origEnd = res.end.bind(res);

	res.write = ((chunk: unknown) => {
		if (chunk) chunks.push(Buffer.from(chunk as string));
		return origWrite(chunk as string);
	}) as typeof res.write;

	const promise = new Promise<{ res: ServerResponse; body: string }>((resolve) => {
		res.end = ((chunk?: unknown) => {
			if (chunk) chunks.push(Buffer.from(chunk as string));
			const body = Buffer.concat(chunks).toString();
			resolve({ res, body });
			return origEnd();
		}) as typeof res.end;
	});

	return { promise, res };
}

// Helper to simulate a Node.js HTTP request
function simulateNodeRequest(
	handler: (req: IncomingMessage, res: ServerResponse) => void,
	opts: {
		method: string;
		url: string;
		headers: Record<string, string>;
		body?: string;
	},
): Promise<{ res: ServerResponse; body: string }> {
	return new Promise((resolve) => {
		const socket = new Socket();
		const req = new IncomingMessage(socket);
		req.method = opts.method;
		req.url = opts.url;
		req.headers = opts.headers;

		const res = new ServerResponse(req);
		const chunks: Buffer[] = [];
		const origWrite = res.write.bind(res);
		const origEnd = res.end.bind(res);

		res.write = ((chunk: unknown) => {
			if (chunk) chunks.push(Buffer.from(chunk as string));
			return origWrite(chunk as string);
		}) as typeof res.write;

		res.end = ((chunk?: unknown) => {
			if (chunk) chunks.push(Buffer.from(chunk as string));
			const body = Buffer.concat(chunks).toString();
			resolve({ res, body });
			return origEnd();
		}) as typeof res.end;

		handler(req, res);

		// Simulate body data events
		if (opts.body) {
			req.emit("data", Buffer.from(opts.body));
		}
		req.emit("end");
	});
}
