/**
 * Tests for the Hono adapter.
 *
 * Hono is Web Standard native, so these use a real Hono app (and real
 * Web Requests) rather than a hand-rolled mock context — the adapter's whole
 * job is to hand `c.req.raw` over intact.
 */

import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { Duplex } from "node:stream";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHonoWsHandler, mountHono, toHonoHandler } from "../../adapters/hono.js";
import type { EmitoServer } from "../../handler.js";

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
		apiBase: `${prefix}/v1`,
		handleUpgrade: vi.fn().mockResolvedValue(undefined),
	} as unknown as EmitoServer;
}

function passedRequest(server: EmitoServer, call = 0): Request {
	return (server.handler as ReturnType<typeof vi.fn>).mock.calls[call]![0] as Request;
}

describe("toHonoHandler", () => {
	it("returns the Emito response to Hono unchanged", async () => {
		const server = createMockServer();
		const app = new Hono();
		app.all("/emito/*", toHonoHandler(server));

		const res = await app.request("http://localhost/emito/health");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ data: { ok: true } });
		expect(server.handler).toHaveBeenCalledOnce();
	});

	it("forwards the full mounted path, not a stripped one", async () => {
		const server = createMockServer();
		const app = new Hono();
		app.all("/emito/*", toHonoHandler(server));

		await app.request("http://localhost/emito/v1/notifications?limit=10");

		expect(new URL(passedRequest(server).url).pathname).toBe("/emito/v1/notifications");
		expect(new URL(passedRequest(server).url).search).toBe("?limit=10");
	});

	it("forwards request headers", async () => {
		const server = createMockServer();
		const app = new Hono();
		app.all("/emito/*", toHonoHandler(server));

		await app.request("http://localhost/emito/health", {
			headers: { authorization: "Bearer test-token", "x-emito-workspace-id": "ws_1" },
		});

		expect(passedRequest(server).headers.get("authorization")).toBe("Bearer test-token");
		expect(passedRequest(server).headers.get("x-emito-workspace-id")).toBe("ws_1");
	});

	it("passes a POST body through readable", async () => {
		const server = createMockServer();
		const app = new Hono();
		app.all("/emito/*", toHonoHandler(server));

		await app.request("http://localhost/emito/v1/notifications", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ event: "test" }),
		});

		const request = passedRequest(server);
		expect(request.method).toBe("POST");
		expect(await request.json()).toEqual({ event: "test" });
	});

	it("replays the body when upstream middleware already consumed it", async () => {
		// A logging/validation middleware calling c.req.json() consumes the raw
		// stream. Emito must still see the bytes — webhook signature verification
		// hashes the raw body.
		const server = createMockServer();
		const app = new Hono();
		app.use("/emito/*", async (c, next) => {
			await c.req.json();
			await next();
		});
		app.all("/emito/*", toHonoHandler(server));

		await app.request("http://localhost/emito/v1/webhooks/resend", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "email.delivered" }),
		});

		const request = passedRequest(server);
		expect(request.bodyUsed).toBe(false);
		expect(await request.json()).toEqual({ type: "email.delivered" });
	});
});

describe("mountHono", () => {
	it("registers a wildcard route under the server prefix", () => {
		const server = createMockServer("/api/notifications");
		const app = { all: vi.fn() };

		mountHono(app, server);

		expect(app.all).toHaveBeenCalledWith("/api/notifications/*", expect.any(Function));
	});

	it("routes requests on the mounted app to the Emito handler", async () => {
		const server = createMockServer();
		const app = new Hono();

		mountHono(app, server);
		const res = await app.request("http://localhost/emito/v1/preferences");

		expect(res.status).toBe(200);
		expect(server.handler).toHaveBeenCalledOnce();
	});

	it("leaves routes outside the prefix to the host app", async () => {
		const server = createMockServer();
		const app = new Hono();
		app.get("/health", (c) => c.text("app-ok"));

		mountHono(app, server);
		const res = await app.request("http://localhost/health");

		expect(await res.text()).toBe("app-ok");
		expect(server.handler).not.toHaveBeenCalled();
	});
});

describe("createHonoWsHandler", () => {
	it("delegates to server.handleUpgrade with correct arguments", () => {
		const server = createMockServer();
		const handler = createHonoWsHandler(server);
		const req = new IncomingMessage(new Socket());
		req.url = "/emito/v1/ws";
		const socket = new Duplex({
			read() {},
			write(_chunk, _enc, cb) {
				cb();
			},
		});
		const head = Buffer.alloc(0);

		handler(req, socket, head);

		expect(server.handleUpgrade).toHaveBeenCalledOnce();
		expect(server.handleUpgrade).toHaveBeenCalledWith(req, socket, head);
	});
});
